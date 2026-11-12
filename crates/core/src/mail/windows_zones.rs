//! Windows time zone names (as Outlook writes them in invitations, e.g.
//! "Central Standard Time") to IANA names (`America/Chicago`), so
//! `chrono-tz` can place them. Each name maps to its zone for territory
//! "001", the one CLDR gives as the zone's default.
//!
//! Generated from Unicode CLDR's `common/supplemental/windowsZones.xml`
//! (mapTimezones otherVersion 7e11800, typeVersion 2021a),
//! fetched 2026-11-12 from https://github.com/unicode-org/cldr. Regenerate
//! from a newer copy of that file rather than editing by hand, and keep the
//! `privacy-ok` marker on the row the privacy check would otherwise flag
//! (a zone name that contains a term from the owner's local denylist).
//!
//! The data is under the Unicode License, whose notice follows:
//!
//! COPYRIGHT AND PERMISSION NOTICE
//!
//! Copyright © 2001–2026 Unicode, Inc.
//!
//! Unicode Technical Standard #35, Unicode Locale Data Markup Language
//! (LDML) made available in this repository is protected by copyright, and
//! permission must be obtained from Unicode, Inc. prior to any
//! reproduction, modification, or other use not permitted by the Unicode
//! Terms of Use <https://www.unicode.org/copyright.html>. Specifically, you
//! may make copies of this publication and may annotate and translate it
//! solely for personal or internal business purposes and not for public
//! distribution, provided that any such permitted copies and modifications
//! fully reproduce all copyright and other legal notices contained in the
//! original. You may not make copies of or modifications to this
//! publication for public distribution, or incorporate it in whole or in
//! part into any product or publication without the express written
//! permission of Unicode. Notwithstanding the foregoing, you may within
//! this repository provide comments and propose changes to this standard
//! and may make copies/forks solely for such purposes provided that you
//! reproduce this copyright notice and these terms of use in any such
//! copy/fork.
//!
//! All other content in this repo is released under UNICODE LICENSE V3
//!
//! NOTICE TO USER: Carefully read the following legal agreement. BY
//! DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
//! SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
//! TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
//! DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.
//!
//! Permission is hereby granted, free of charge, to any person obtaining a
//! copy of data files and any associated documentation (the "Data Files") or
//! software and any associated documentation (the "Software") to deal in the
//! Data Files or Software without restriction, including without limitation
//! the rights to use, copy, modify, merge, publish, distribute, and/or sell
//! copies of the Data Files or Software, and to permit persons to whom the
//! Data Files or Software are furnished to do so, provided that either (a)
//! this copyright and permission notice appear with all copies of the Data
//! Files or Software, or (b) this copyright and permission notice appear in
//! associated Documentation.
//!
//! THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
//! KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//! MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
//! THIRD PARTY RIGHTS.
//!
//! IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
//! BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
//! OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
//! WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
//! ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
//! FILES OR SOFTWARE.
//!
//! Except as contained in this notice, the name of a copyright holder shall
//! not be used in advertising or otherwise to promote the sale, use or other
//! dealings in these Data Files or Software without prior written
//! authorization of the copyright holder.
//!
//! SPDX-License-Identifier: Unicode-3.0

/// `(Windows name, IANA name)`, sorted by Windows name.
pub(crate) const WINDOWS_ZONES: &[(&str, &str)] = &[
    ("AUS Central Standard Time", "Australia/Darwin"),
    ("AUS Eastern Standard Time", "Australia/Sydney"),
    ("Afghanistan Standard Time", "Asia/Kabul"),
    ("Alaskan Standard Time", "America/Anchorage"), // privacy-ok: a Windows time zone name from Unicode CLDR, not mail
    ("Alberta Standard Time", "America/Edmonton"),
    ("Aleutian Standard Time", "America/Adak"),
    ("Altai Standard Time", "Asia/Barnaul"),
    ("Arab Standard Time", "Asia/Riyadh"),
    ("Arabian Standard Time", "Asia/Dubai"),
    ("Arabic Standard Time", "Asia/Baghdad"),
    ("Argentina Standard Time", "America/Buenos_Aires"),
    ("Astrakhan Standard Time", "Europe/Astrakhan"),
    ("Atlantic Standard Time", "America/Halifax"),
    ("Aus Central W. Standard Time", "Australia/Eucla"),
    ("Azerbaijan Standard Time", "Asia/Baku"),
    ("Azores Standard Time", "Atlantic/Azores"),
    ("Bahia Standard Time", "America/Bahia"),
    ("Bangladesh Standard Time", "Asia/Dhaka"),
    ("Belarus Standard Time", "Europe/Minsk"),
    ("Bougainville Standard Time", "Pacific/Bougainville"),
    ("British Columbia Standard Time", "America/Vancouver"),
    ("Canada Central Standard Time", "America/Regina"),
    ("Cape Verde Standard Time", "Atlantic/Cape_Verde"),
    ("Caucasus Standard Time", "Asia/Yerevan"),
    ("Cen. Australia Standard Time", "Australia/Adelaide"),
    ("Central America Standard Time", "America/Guatemala"),
    ("Central Asia Standard Time", "Asia/Bishkek"),
    ("Central Brazilian Standard Time", "America/Cuiaba"),
    ("Central Europe Standard Time", "Europe/Budapest"),
    ("Central European Standard Time", "Europe/Warsaw"),
    ("Central Pacific Standard Time", "Pacific/Guadalcanal"),
    ("Central Standard Time", "America/Chicago"),
    ("Central Standard Time (Mexico)", "America/Mexico_City"),
    ("Chatham Islands Standard Time", "Pacific/Chatham"),
    ("China Standard Time", "Asia/Shanghai"),
    ("Cuba Standard Time", "America/Havana"),
    ("Dateline Standard Time", "Etc/GMT+12"),
    ("E. Africa Standard Time", "Africa/Nairobi"),
    ("E. Australia Standard Time", "Australia/Brisbane"),
    ("E. Europe Standard Time", "Europe/Chisinau"),
    ("E. South America Standard Time", "America/Sao_Paulo"),
    ("Easter Island Standard Time", "Pacific/Easter"),
    ("Eastern Standard Time", "America/New_York"),
    ("Eastern Standard Time (Mexico)", "America/Cancun"),
    ("Egypt Standard Time", "Africa/Cairo"),
    ("Ekaterinburg Standard Time", "Asia/Yekaterinburg"),
    ("FLE Standard Time", "Europe/Kiev"),
    ("Fiji Standard Time", "Pacific/Fiji"),
    ("GMT Standard Time", "Europe/London"),
    ("GTB Standard Time", "Europe/Bucharest"),
    ("Georgian Standard Time", "Asia/Tbilisi"),
    ("Greenland Standard Time", "America/Godthab"),
    ("Greenwich Standard Time", "Atlantic/Reykjavik"),
    ("Haiti Standard Time", "America/Port-au-Prince"),
    ("Hawaiian Standard Time", "Pacific/Honolulu"),
    ("India Standard Time", "Asia/Calcutta"),
    ("Iran Standard Time", "Asia/Tehran"),
    ("Israel Standard Time", "Asia/Jerusalem"),
    ("Jordan Standard Time", "Asia/Amman"),
    ("Kaliningrad Standard Time", "Europe/Kaliningrad"),
    ("Korea Standard Time", "Asia/Seoul"),
    ("Libya Standard Time", "Africa/Tripoli"),
    ("Line Islands Standard Time", "Pacific/Kiritimati"),
    ("Lord Howe Standard Time", "Australia/Lord_Howe"),
    ("Magadan Standard Time", "Asia/Magadan"),
    ("Magallanes Standard Time", "America/Punta_Arenas"),
    ("Manitoba Standard Time", "America/Winnipeg"),
    ("Marquesas Standard Time", "Pacific/Marquesas"),
    ("Mauritius Standard Time", "Indian/Mauritius"),
    ("Middle East Standard Time", "Asia/Beirut"),
    ("Montevideo Standard Time", "America/Montevideo"),
    ("Morocco Standard Time", "Africa/Casablanca"),
    ("Mountain Standard Time", "America/Denver"),
    ("Mountain Standard Time (Mexico)", "America/Mazatlan"),
    ("Myanmar Standard Time", "Asia/Rangoon"),
    ("N. Central Asia Standard Time", "Asia/Novosibirsk"),
    ("Namibia Standard Time", "Africa/Windhoek"),
    ("Nepal Standard Time", "Asia/Katmandu"),
    ("New Zealand Standard Time", "Pacific/Auckland"),
    ("Newfoundland Standard Time", "America/St_Johns"),
    ("Norfolk Standard Time", "Pacific/Norfolk"),
    ("North Asia East Standard Time", "Asia/Irkutsk"),
    ("North Asia Standard Time", "Asia/Krasnoyarsk"),
    ("North Korea Standard Time", "Asia/Pyongyang"),
    ("Omsk Standard Time", "Asia/Omsk"),
    ("Pacific SA Standard Time", "America/Santiago"),
    ("Pacific Standard Time", "America/Los_Angeles"),
    ("Pacific Standard Time (Mexico)", "America/Tijuana"),
    ("Pakistan Standard Time", "Asia/Karachi"),
    ("Paraguay Standard Time", "America/Asuncion"),
    ("Qyzylorda Standard Time", "Asia/Qyzylorda"),
    ("Romance Standard Time", "Europe/Paris"),
    ("Russia Time Zone 10", "Asia/Srednekolymsk"),
    ("Russia Time Zone 11", "Asia/Kamchatka"),
    ("Russia Time Zone 3", "Europe/Samara"),
    ("Russian Standard Time", "Europe/Moscow"),
    ("SA Eastern Standard Time", "America/Cayenne"),
    ("SA Pacific Standard Time", "America/Bogota"),
    ("SA Western Standard Time", "America/La_Paz"),
    ("SE Asia Standard Time", "Asia/Bangkok"),
    ("Saint Pierre Standard Time", "America/Miquelon"),
    ("Sakhalin Standard Time", "Asia/Sakhalin"),
    ("Samoa Standard Time", "Pacific/Apia"),
    ("Sao Tome Standard Time", "Africa/Sao_Tome"),
    ("Saratov Standard Time", "Europe/Saratov"),
    ("Singapore Standard Time", "Asia/Singapore"),
    ("South Africa Standard Time", "Africa/Johannesburg"),
    ("South Sudan Standard Time", "Africa/Juba"),
    ("Sri Lanka Standard Time", "Asia/Colombo"),
    ("Sudan Standard Time", "Africa/Khartoum"),
    ("Syria Standard Time", "Asia/Damascus"),
    ("Taipei Standard Time", "Asia/Taipei"),
    ("Tasmania Standard Time", "Australia/Hobart"),
    ("Tocantins Standard Time", "America/Araguaina"),
    ("Tokyo Standard Time", "Asia/Tokyo"),
    ("Tomsk Standard Time", "Asia/Tomsk"),
    ("Tonga Standard Time", "Pacific/Tongatapu"),
    ("Transbaikal Standard Time", "Asia/Chita"),
    ("Turkey Standard Time", "Europe/Istanbul"),
    ("Turks And Caicos Standard Time", "America/Grand_Turk"),
    ("US Eastern Standard Time", "America/Indianapolis"),
    ("US Mountain Standard Time", "America/Phoenix"),
    ("UTC", "Etc/UTC"),
    ("UTC+12", "Etc/GMT-12"),
    ("UTC+13", "Etc/GMT-13"),
    ("UTC-02", "Etc/GMT+2"),
    ("UTC-08", "Etc/GMT+8"),
    ("UTC-09", "Etc/GMT+9"),
    ("UTC-11", "Etc/GMT+11"),
    ("Ulaanbaatar Standard Time", "Asia/Ulaanbaatar"),
    ("Venezuela Standard Time", "America/Caracas"),
    ("Vladivostok Standard Time", "Asia/Vladivostok"),
    ("Volgograd Standard Time", "Europe/Volgograd"),
    ("W. Australia Standard Time", "Australia/Perth"),
    ("W. Central Africa Standard Time", "Africa/Lagos"),
    ("W. Europe Standard Time", "Europe/Berlin"),
    ("W. Mongolia Standard Time", "Asia/Hovd"),
    ("West Asia Standard Time", "Asia/Tashkent"),
    ("West Bank Standard Time", "Asia/Hebron"),
    ("West Pacific Standard Time", "Pacific/Port_Moresby"),
    ("Yakutsk Standard Time", "Asia/Yakutsk"),
    ("Yukon Standard Time", "America/Whitehorse"),
];

/// The IANA name for a Windows time zone name, if CLDR lists it.
pub(crate) fn iana_for(windows: &str) -> Option<&'static str> {
    WINDOWS_ZONES
        .binary_search_by(|(name, _)| (*name).cmp(windows))
        .ok()
        .map(|i| WINDOWS_ZONES[i].1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorted_for_the_lookup() {
        assert!(WINDOWS_ZONES.windows(2).all(|w| w[0].0 < w[1].0));
    }

    #[test]
    fn every_zone_is_one_chrono_tz_knows() {
        for (windows, iana) in WINDOWS_ZONES {
            assert!(iana.parse::<chrono_tz::Tz>().is_ok(), "{windows} -> {iana}");
        }
    }

    #[test]
    fn finds_outlooks_names() {
        assert_eq!(iana_for("Eastern Standard Time"), Some("America/New_York"));
        assert_eq!(iana_for("Central Standard Time"), Some("America/Chicago"));
        assert_eq!(iana_for("W. Europe Standard Time"), Some("Europe/Berlin"));
        assert_eq!(iana_for("Lunar Standard Time"), None);
    }
}
