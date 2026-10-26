//! The part of Gmail's search language the made-up Google understands:
//! words and "quoted phrases", `-` for not, `OR`, `( )` and `{ }`
//! groups, and `from:` `to:` `cc:` `subject:` `label:` `in:` `is:` `has:`
//! `filename:` `larger:` `smaller:` `newer_than:` `older_than:`. Enough for
//! the app's own queries (rules, attachments, remote search); anything it
//! doesn't know matches.

/// What a search looks at in one message, lowercased.
pub(crate) struct Fields<'a> {
    pub from: &'a str,
    pub to: &'a str,
    pub cc: &'a str,
    pub subject: &'a str,
    /// Subject, addresses and the body's text.
    pub text: &'a str,
    /// Label IDs and user labels' names.
    pub labels: &'a [String],
    pub filenames: &'a [String],
    pub size: usize,
    pub date_ms: u64,
    pub now_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
enum Node {
    All(Vec<Node>),
    Any(Vec<Node>),
    Not(Box<Node>),
    /// `key:value`, the value a word or a group.
    Field(String, Box<Node>),
    Word(String),
}

pub(crate) fn matches(q: &str, f: &Fields<'_>) -> bool {
    let tokens = tokenize(q);
    let mut at = 0;
    let node = parse_all(&tokens, &mut at, None);
    eval(&node, None, f)
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Open(char),
    Close(char),
    Minus,
    /// A word; `key:` when it ends with a colon.
    Word(String),
    Quoted(String),
}

fn tokenize(q: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut chars = q.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            c if c.is_whitespace() => {
                chars.next();
            }
            '(' | '{' => {
                chars.next();
                out.push(Token::Open(c));
            }
            ')' | '}' => {
                chars.next();
                out.push(Token::Close(c));
            }
            '-' => {
                chars.next();
                out.push(Token::Minus);
            }
            '"' => {
                chars.next();
                let phrase: String = chars.by_ref().take_while(|&c| c != '"').collect();
                out.push(Token::Quoted(phrase));
            }
            _ => {
                let mut word = String::new();
                while let Some(&c) = chars.peek() {
                    if c.is_whitespace() || "(){}\"".contains(c) {
                        break;
                    }
                    word.push(c);
                    chars.next();
                    if c == ':' {
                        break;
                    }
                }
                out.push(Token::Word(word));
            }
        }
    }
    out
}

/// Terms up to the closing bracket (or the end), joined by AND, or by OR
/// inside `{ }` and around an `OR` word.
fn parse_all(tokens: &[Token], at: &mut usize, close: Option<char>) -> Node {
    let mut alternatives: Vec<Vec<Node>> = vec![Vec::new()];
    while let Some(token) = tokens.get(*at) {
        match token {
            Token::Close(c) if Some(*c) == close => {
                *at += 1;
                break;
            }
            Token::Word(w) if w == "OR" => {
                *at += 1;
                alternatives.push(Vec::new());
            }
            _ => {
                let node = parse_term(tokens, at);
                if let (Some(node), Some(terms)) = (node, alternatives.last_mut()) {
                    terms.push(node);
                }
            }
        }
    }
    let joined: Vec<Node> = alternatives
        .into_iter()
        .filter(|terms| !terms.is_empty())
        .map(|terms| {
            if close == Some('}') {
                Node::Any(terms)
            } else {
                Node::All(terms)
            }
        })
        .collect();
    match joined.len() {
        1 => joined.into_iter().next().unwrap_or(Node::All(Vec::new())),
        _ => Node::Any(joined),
    }
}

fn parse_term(tokens: &[Token], at: &mut usize) -> Option<Node> {
    let token = tokens.get(*at)?.clone();
    *at += 1;
    match token {
        Token::Minus => parse_term(tokens, at).map(|n| Node::Not(Box::new(n))),
        Token::Open(c) => Some(parse_all(
            tokens,
            at,
            Some(if c == '(' { ')' } else { '}' }),
        )),
        Token::Close(_) => None,
        Token::Quoted(phrase) => Some(Node::Word(phrase.to_lowercase())),
        Token::Word(w) => match w.strip_suffix(':') {
            Some(key) => {
                let value = parse_term(tokens, at).unwrap_or(Node::All(Vec::new()));
                Some(Node::Field(key.to_lowercase(), Box::new(value)))
            }
            None => Some(Node::Word(w.to_lowercase())),
        },
    }
}

fn eval(node: &Node, key: Option<&str>, f: &Fields<'_>) -> bool {
    match node {
        Node::All(nodes) => nodes.iter().all(|n| eval(n, key, f)),
        Node::Any(nodes) => nodes.iter().any(|n| eval(n, key, f)),
        Node::Not(n) => !eval(n, key, f),
        Node::Field(k, n) => eval(n, Some(k), f),
        Node::Word(w) => word(key, w, f),
    }
}

fn word(key: Option<&str>, w: &str, f: &Fields<'_>) -> bool {
    let label = |name: &str| {
        let name = name.replace(['-', '/'], " ");
        f.labels
            .iter()
            .any(|l| l.to_lowercase().replace(['-', '/'], " ") == name)
    };
    match key {
        None => f.text.contains(w),
        Some("from") => f.from.contains(w),
        Some("to") => f.to.contains(w) || f.cc.contains(w),
        Some("cc") => f.cc.contains(w),
        Some("subject") => f.subject.contains(w),
        Some("label") => label(w),
        Some("in") => match w {
            "anywhere" => true,
            "drafts" => label("draft"),
            _ => label(w),
        },
        Some("is") => match w {
            "read" => !label("unread"),
            _ => label(w),
        },
        Some("has") => match w {
            "attachment" => !f.filenames.is_empty(),
            _ => true,
        },
        Some("filename") => f.filenames.iter().any(|n| n.contains(w)),
        Some("larger") => bytes(w).is_none_or(|b| f.size > b),
        Some("smaller") => bytes(w).is_none_or(|b| f.size < b),
        Some("newer_than") => age(w).is_none_or(|ms| f.date_ms + ms > f.now_ms),
        Some("older_than") => age(w).is_none_or(|ms| f.date_ms + ms <= f.now_ms),
        Some(_) => true,
    }
}

/// `2048`, `10k`, `5m`.
fn bytes(w: &str) -> Option<usize> {
    let (number, unit) = match w.chars().last()? {
        'k' => (&w[..w.len() - 1], 1024),
        'm' => (&w[..w.len() - 1], 1024 * 1024),
        _ => (w, 1),
    };
    number.parse::<usize>().ok().map(|n| n * unit)
}

/// `3d`, `2m`, `1y`, in milliseconds.
fn age(w: &str) -> Option<u64> {
    let day = 24 * 60 * 60 * 1000;
    let unit = match w.chars().last()? {
        'd' => day,
        'm' => 30 * day,
        'y' => 365 * day,
        _ => return None,
    };
    w[..w.len() - 1].parse::<u64>().ok().map(|n| n * unit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields<'a>(labels: &'a [String], filenames: &'a [String]) -> Fields<'a> {
        Fields {
            from: "maya chen <maya@chen.example>",
            to: "alex <alex@rivera.example>",
            cc: "",
            subject: "lisbon itinerary",
            text: "lisbon itinerary maya chen flights on friday",
            labels,
            filenames,
            size: 4000,
            date_ms: 1_000,
            now_ms: 2_000,
        }
    }

    #[test]
    fn reads_the_queries_the_app_sends() {
        let labels = vec!["INBOX".to_string(), "Travel".to_string()];
        let files = vec!["itinerary.pdf".to_string()];
        let f = fields(&labels, &files);
        for q in [
            "lisbon",
            "\"flights on friday\"",
            "from:maya",
            "from:(nobody@x.example OR maya@chen.example)",
            "subject:(lisbon itinerary) has:attachment",
            "in:inbox label:travel",
            "-{invoice receipt} larger:2k smaller:10k",
            "newer_than:1d is:read",
        ] {
            assert!(matches(q, &f), "{q}");
        }
        for q in [
            "invoice",
            "-lisbon",
            "from:alex",
            "in:spam",
            "is:unread",
            "{invoice receipt}",
            "older_than:1d",
        ] {
            assert!(!matches(q, &f), "{q}");
        }
        let none: Vec<String> = Vec::new();
        assert!(!matches("has:attachment", &fields(&labels, &none)));
    }
}
