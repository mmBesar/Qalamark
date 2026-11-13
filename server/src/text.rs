// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Small text helpers: safe file names and a tiny text diff.

/// Turn a note title into a safe file name (without ".md").
pub fn safe_name(title: &str) -> String {
    let mut s: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    s = s.trim().trim_matches('.').trim().to_string();
    while s.len() > 120 {
        s.pop();
    }
    if s.is_empty() {
        "Untitled".to_string()
    } else {
        s
    }
}

/// Usernames: 2-32 characters, a-z 0-9 . _ -  (lower case).
pub fn valid_username(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
        && !name.starts_with('.')
}

/// What to change to turn `old` into `new`: (start, delete_len, insert_text),
/// measured in UTF-16 units (the unit the browser editor uses).
pub fn diff(old: &str, new: &str) -> Option<(u32, u32, String)> {
    if old == new {
        return None;
    }
    let a: Vec<char> = old.chars().collect();
    let b: Vec<char> = new.chars().collect();
    let mut pre = 0;
    while pre < a.len() && pre < b.len() && a[pre] == b[pre] {
        pre += 1;
    }
    let mut suf = 0;
    while suf < a.len() - pre && suf < b.len() - pre && a[a.len() - 1 - suf] == b[b.len() - 1 - suf] {
        suf += 1;
    }
    let u16len = |cs: &[char]| cs.iter().map(|c| c.len_utf16() as u32).sum::<u32>();
    let start = u16len(&a[..pre]);
    let del = u16len(&a[pre..a.len() - suf]);
    let ins: String = b[pre..b.len() - suf].iter().collect();
    Some((start, del, ins))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe() {
        assert_eq!(safe_name("a/b:c"), "a-b-c");
        assert_eq!(safe_name("  ..  "), "Untitled");
        assert_eq!(safe_name("قائمة التسوق"), "قائمة التسوق");
    }

    #[test]
    fn usernames() {
        assert!(valid_username("mo.besar"));
        assert!(!valid_username("A"));
        assert!(!valid_username("bad name"));
    }

    #[test]
    fn diff_finds_the_changed_middle() {
        assert_eq!(diff("hello world", "hello brave world"), Some((6, 0, "brave ".into())));
        assert_eq!(diff("abc", "aXc"), Some((1, 1, "X".into())));
        assert_eq!(diff("same", "same"), None);
        // an emoji takes two UTF-16 units
        assert_eq!(diff("😀a", "😀b"), Some((2, 1, "b".into())));
    }
}
