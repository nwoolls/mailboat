//! The writing assistant's answer (Markdown) as HTML for the composer:
//! paragraphs, line breaks, bold, italic, strikethrough, lists, quotes,
//! tables and links. Nothing else survives: no images (a model steered by
//! an email could add a tracking pixel), no raw HTML, no styles, so the
//! email keeps the composer's own font and spacing.
//!
//! The composer, like Gmail, shows a blank line as an empty paragraph and
//! puts no gap between paragraphs, so blank lines between blocks become
//! `<p></p>` and single line breaks stay breaks (Markdown would join them).

use std::collections::HashSet;

use pulldown_cmark::{html, CowStr, Event, Options, Parser, Tag, TagEnd};

/// Markdown to the composer's HTML, cleaned to the tags it can edit.
pub fn markdown_to_html(markdown: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    let mut events: Vec<Event> = Vec::new();
    let mut depth = 0usize;
    let mut blocks = 0usize;
    for event in Parser::new_ext(markdown, options) {
        match event {
            Event::Start(tag) => {
                let block = is_block(&tag);
                if block && depth == 0 {
                    if blocks > 0 {
                        events.push(Event::Html(CowStr::Borrowed("<p></p>")));
                    }
                    blocks += 1;
                }
                if block {
                    depth += 1;
                }
                events.push(match tag {
                    // Headings read as a bold line in an email.
                    Tag::Heading { .. } => Event::Html(CowStr::Borrowed("<p><strong>")),
                    // Images become their description.
                    Tag::Image { .. } => continue,
                    Tag::CodeBlock(_) => Event::Html(CowStr::Borrowed("<p>")),
                    other => Event::Start(other),
                });
            }
            Event::End(end) => {
                if is_block_end(&end) {
                    depth = depth.saturating_sub(1);
                }
                events.push(match end {
                    TagEnd::Heading(_) => Event::Html(CowStr::Borrowed("</strong></p>")),
                    TagEnd::Image => continue,
                    TagEnd::CodeBlock => Event::Html(CowStr::Borrowed("</p>")),
                    other => Event::End(other),
                });
            }
            Event::SoftBreak => events.push(Event::HardBreak),
            // Raw HTML from the model is shown as text, never used.
            Event::Html(raw) | Event::InlineHtml(raw) => events.push(Event::Text(raw)),
            Event::Code(code) => events.push(Event::Text(code)),
            other => events.push(other),
        }
    }
    let mut out = String::new();
    html::push_html(&mut out, events.into_iter());
    clean(&out)
}

fn is_block(tag: &Tag) -> bool {
    matches!(
        tag,
        Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::BlockQuote(_)
            | Tag::CodeBlock(_)
            | Tag::List(_)
            | Tag::Table(_)
    )
}

fn is_block_end(end: &TagEnd) -> bool {
    matches!(
        end,
        TagEnd::Paragraph
            | TagEnd::Heading(_)
            | TagEnd::BlockQuote(_)
            | TagEnd::CodeBlock
            | TagEnd::List(_)
            | TagEnd::Table
    )
}

/// Keeps only what the composer edits; links only to web and mail.
fn clean(html: &str) -> String {
    let tags: HashSet<&str> = [
        "p",
        "br",
        "strong",
        "em",
        "del",
        "s",
        "ul",
        "ol",
        "li",
        "blockquote",
        "a",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
    ]
    .into_iter()
    .collect();
    ammonia::Builder::default()
        .tags(tags)
        .generic_attributes(HashSet::new())
        .tag_attributes(
            [
                ("a", ["href"].into_iter().collect()),
                ("ol", ["start"].into_iter().collect()),
            ]
            .into_iter()
            .collect(),
        )
        .url_schemes(["http", "https", "mailto"].into_iter().collect())
        .link_rel(None)
        .clean(html)
        .to_string()
        .replace('\n', "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_lines_become_empty_paragraphs_and_breaks_stay() {
        assert_eq!(
            markdown_to_html("Hi Sam,\n\nThursday works.\nSee you then.\n\nThanks,"),
            "<p>Hi Sam,</p><p></p><p>Thursday works.<br>See you then.</p><p></p><p>Thanks,</p>"
        );
    }

    #[test]
    fn lists_emphasis_and_tables_come_through() {
        let html = markdown_to_html(
            "Plan:\n\n- **Mon**: draft\n- *Tue*: review\n\n1. One\n2. ~~Two~~\n\n| Day | Who |\n|---|---|\n| Mon | Sam |",
        );
        assert!(
            html.contains(
                "<ul><li><strong>Mon</strong>: draft</li><li><em>Tue</em>: review</li></ul>"
            ),
            "{html}"
        );
        assert!(
            html.contains("<ol><li>One</li><li><del>Two</del></li></ol>"),
            "{html}"
        );
        assert!(html.contains("<table><thead><tr><th>Day</th><th>Who</th></tr></thead><tbody><tr><td>Mon</td><td>Sam</td></tr></tbody></table>"), "{html}");
        assert!(!html.contains("style"), "no styles of its own");
    }

    #[test]
    fn nothing_unsafe_or_off_style_gets_through() {
        let html = markdown_to_html(
            "# Title\n\n![pixel](https://t.example/p.gif)\n\n<img src=x onerror=alert(1)><script>x</script>\n\n[site](https://example.com) [bad](javascript:alert(1))",
        );
        assert!(html.starts_with("<p><strong>Title</strong></p>"), "{html}");
        assert!(!html.contains("<img"), "{html}");
        assert!(!html.contains("<script"), "{html}");
        assert!(html.contains("&lt;img"), "raw HTML shows as text: {html}");
        assert!(
            html.contains(r#"<a href="https://example.com">site</a>"#),
            "{html}"
        );
        assert!(!html.contains("javascript:"), "{html}");
        assert!(
            html.contains("pixel"),
            "an image leaves its description: {html}"
        );
    }
}
