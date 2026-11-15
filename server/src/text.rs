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

/// A folder path like "Work/Projects": every part made safe, empty and dot parts dropped.
pub fn safe_folder(folder: &str) -> String {
    folder
        .split('/')
        .map(|p| p.trim().trim_matches('.').trim().to_string())
        .filter(|p| !p.is_empty())
        .take(8)
        .map(|p| safe_name(&p))
        .collect::<Vec<_>>()
        .join("/")
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

/// The pages a text links to with [[Page]], [[Page|shown text]] or [[Page#Heading]].
pub fn wiki_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        rest = &rest[i + 2..];
        let Some(j) = rest.find("]]") else { break };
        let inner = &rest[..j];
        if !inner.contains('\n') {
            let target = inner.split('|').next().unwrap_or("").split('#').next().unwrap_or("").trim();
            if !target.is_empty() {
                out.push(target.to_string());
            }
        }
        rest = &rest[j + 2..];
    }
    out
}

/// Rewrites links to the page `old` so they point to `new` (`[[Old]]`, `[[Old|text]]`, `[[Old#Head]]`,
/// `[[Folder/Old]]`). Returns None when nothing changed.
pub fn rewrite_links(text: &str, old: &str, new: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut changed = false;
    while let Some(i) = rest.find("[[") {
        out.push_str(&rest[..i + 2]);
        rest = &rest[i + 2..];
        let Some(j) = rest.find("]]") else { break };
        let inner = &rest[..j];
        if inner.contains('\n') {
            out.push_str(inner);
        } else {
            let cut = inner.find(|c| c == '|' || c == '#').unwrap_or(inner.len());
            let (target, tail) = inner.split_at(cut);
            let (dir, name) = match target.trim_end().rfind('/') {
                Some(k) => (&target[..=k], target[k + 1..].trim()),
                None => ("", target.trim()),
            };
            if !name.is_empty() && name.to_lowercase() == old.to_lowercase() {
                out.push_str(dir);
                out.push_str(new);
                out.push_str(tail);
                changed = true;
            } else {
                out.push_str(inner);
            }
        }
        out.push_str("]]");
        rest = &rest[j + 2..];
    }
    out.push_str(rest);
    changed.then_some(out)
}

/// Sets the `title:` property of the note when it already has one. None when nothing changed.
pub fn set_title_property(text: &str, new: &str) -> Option<String> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.first().map(|l| l.trim_end()) != Some("---") {
        return None;
    }
    let end = lines.iter().skip(1).position(|l| l.trim_end() == "---")? + 1;
    let idx = (1..end).find(|&i| lines[i].starts_with("title:"))?;
    let quoted = new.contains(|c: char| ":#[]{}'\"&*!|>%@`".contains(c));
    let want = if quoted { format!("title: \"{}\"", new.replace('"', "\\\"")) } else { format!("title: {}", new) };
    if lines[idx].trim_end() == want {
        return None;
    }
    let owned = want;
    lines[idx] = &owned;
    Some(lines.join("\n"))
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
    fn finds_wiki_links() {
        let t = "See [[Shopping]], [[Ideas|my ideas]] and [[Plan#Week 2]]. Not [[ ]] or [[broken";
        assert_eq!(wiki_links(t), vec!["Shopping", "Ideas", "Plan"]);
    }

    #[test]
    fn rewrites_links() {
        let t = "A [[Old]] b [[old|shown]] c [[Old#Head]] d [[Dir/Old]] e [[Other]] f [[Older]]";
        assert_eq!(rewrite_links(t, "Old", "New").unwrap(), "A [[New]] b [[New|shown]] c [[New#Head]] d [[Dir/New]] e [[Other]] f [[Older]]");
        assert!(rewrite_links("nothing [[x]] here", "Old", "New").is_none());
    }

    #[test]
    fn sets_title_property() {
        assert_eq!(set_title_property("---\ntitle: A\ntags: [x]\n---\nbody", "B").unwrap(), "---\ntitle: B\ntags: [x]\n---\nbody");
        assert!(set_title_property("---\ntags: [x]\n---\nbody", "B").is_none());
        assert!(set_title_property("no front matter\ntitle: A", "B").is_none());
        assert!(set_title_property("---\ntitle: B\n---", "B").is_none());
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
