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

// ---- standard links between notes (twin of app/src/lib/mdlinks.ts; docs/MARKDOWN.md) ----

/// An inline link or picture address found in a text: byte range of the address as written, and the address itself.
pub struct Found {
    pub start: usize,
    pub end: usize,
    pub dest: String,
    pub angle: bool,
}

/// Every `[label](address)` and `![alt](address)` outside code.
pub fn scan_links(text: &str) -> Vec<Found> {
    let mut out = Vec::new();
    let mut fence = false;
    let mut off = 0;
    for line in text.split('\n') {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
        } else if !fence {
            scan_line(line, off, &mut out);
        }
        off += line.len() + 1;
    }
    out
}

fn scan_line(line: &str, off: usize, out: &mut Vec<Found>) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'`' => match line[i + 1..].find('`') {
                Some(k) => i += k + 2,
                None => i += 1,
            },
            b']' if b.get(i + 1) == Some(&b'(') => {
                // the label must open somewhere before on this line
                if !line[..i].contains('[') {
                    i += 1;
                    continue;
                }
                let mut j = i + 2;
                while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
                    j += 1;
                }
                let start = j;
                let (end, angle) = if b.get(j) == Some(&b'<') {
                    match line[j..].find('>') {
                        Some(k) => (j + k + 1, true),
                        None => {
                            i += 1;
                            continue;
                        }
                    }
                } else {
                    let mut depth = 0;
                    while j < b.len() {
                        match b[j] {
                            b'(' => depth += 1,
                            b')' if depth == 0 => break,
                            b')' => depth -= 1,
                            b' ' | b'\t' | b'<' | b'>' => break,
                            _ => {}
                        }
                        j += 1;
                    }
                    (j, false)
                };
                // what follows must close the link (an optional "title" is allowed)
                let after = line[end..].trim_start();
                if end > start && (after.starts_with(')') || after.starts_with('"') || after.starts_with('\'')) {
                    let raw = &line[start..end];
                    let dest = if angle { raw[1..raw.len() - 1].to_string() } else { raw.to_string() };
                    out.push(Found { start: off + start, end: off + end, dest, angle });
                }
                i = end.max(i + 1);
            }
            _ => i += 1,
        }
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() + 0 && i + 2 <= b.len() - 1 + 0 {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn has_scheme(s: &str) -> bool {
    let mut it = s.chars();
    matches!(it.next(), Some(c) if c.is_ascii_alphabetic())
        && s.find(':').map_or(false, |k| s[..k].chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')))
}

/// An address inside a folder as a path from the top of the notes folder, plus its #fragment. None for web addresses,
/// anchors and anything that leaves the notes folder.
pub fn resolve_dest(from_folder: &str, dest: &str) -> Option<(String, String)> {
    if dest.is_empty() || has_scheme(dest) || dest.starts_with('#') || dest.starts_with('/') {
        return None;
    }
    let (path, frag) = match dest.find('#') {
        Some(h) => (&dest[..h], percent_decode(&dest[h + 1..])),
        None => (dest, String::new()),
    };
    let rel = percent_decode(path.split('?').next().unwrap_or(""));
    let mut parts: Vec<&str> = if from_folder.is_empty() { vec![] } else { from_folder.split('/').collect() };
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some((parts.join("/"), frag))
}

/// `path` as an address relative to a folder: `../_images/a.png`.
pub fn relative_to(from_folder: &str, path: &str) -> String {
    let a: Vec<&str> = if from_folder.is_empty() { vec![] } else { from_folder.split('/').collect() };
    let b: Vec<&str> = path.split('/').collect();
    let mut i = 0;
    while i < a.len() && i + 1 < b.len() && a[i].to_lowercase() == b[i].to_lowercase() {
        i += 1;
    }
    let mut out: Vec<&str> = vec![".."; a.len() - i];
    out.extend_from_slice(&b[i..]);
    out.join("/")
}

/// GitHub's anchor for a heading.
pub fn slug(h: &str) -> String {
    h.trim().to_lowercase().chars().filter(|c| c.is_alphanumeric() || c.is_whitespace() || matches!(c, '_' | '-')).map(|c| if c.is_whitespace() { '-' } else { c }).collect()
}

fn write_dest(path: &str, frag: &str) -> String {
    let full = if frag.is_empty() { path.to_string() } else { format!("{path}#{frag}") };
    if full.chars().any(|c| c.is_whitespace() || matches!(c, '(' | ')' | '<' | '>')) {
        format!("<{full}>")
    } else {
        full
    }
}

/// After something moved: every relative address of a note that was in `from_old` and is now in `from_new` is resolved
/// the old way and written the new way; `moved` says where a path that moved goes. None when nothing changed.
pub fn retarget(text: &str, from_old: &str, from_new: &str, moved: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for f in scan_links(text) {
        let Some((path, frag)) = resolve_dest(from_old, &f.dest) else { continue };
        let to = moved(&path).unwrap_or_else(|| path.clone());
        if to == path && from_old == from_new {
            continue;
        }
        let frag = if frag.chars().any(|c| !(c.is_alphanumeric() || matches!(c, '_' | '-'))) { slug(&frag) } else { frag };
        let dest = write_dest(&relative_to(from_new, &to), &frag);
        let was = if f.angle { format!("<{}>", f.dest) } else { f.dest.clone() };
        if dest == was {
            continue;
        }
        out.push_str(&text[last..f.start]);
        out.push_str(&dest);
        last = f.end;
    }
    if last == 0 {
        return None;
    }
    out.push_str(&text[last..]);
    Some(out)
}

/// The notes a text links to with standard links, as paths from the top of the notes folder.
pub fn note_link_paths(text: &str, from_folder: &str) -> Vec<String> {
    scan_links(text)
        .iter()
        .filter_map(|f| resolve_dest(from_folder, &f.dest))
        .map(|(p, _)| p)
        .filter(|p| p.to_lowercase().ends_with(".md"))
        .collect()
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

    #[test]
    fn standard_links_follow_moves() {
        let mv = |p: &str| (p == "Old.md").then(|| "New/Old.md".to_string());
        assert_eq!(retarget("[x](Old.md)", "", "", &mv).unwrap(), "[x](New/Old.md)");
        assert!(retarget("[x](A/Old.md)", "", "", &mv).is_none());
        let mv2 = |p: &str| (p == "My old.md").then(|| "My new.md".to_string());
        assert_eq!(retarget("[x](<My old.md>)", "", "", &mv2).unwrap(), "[x](<My new.md>)");
        let none = |_: &str| None;
        let t = "See [x](Old.md) and [y](../Other/z.md) and ![i](../_images/p.png) and `[c](Old.md)`.";
        assert_eq!(retarget(t, "Work", "Work/Sub", &none).unwrap(), "See [x](../Old.md) and [y](../../Other/z.md) and ![i](../../_images/p.png) and `[c](Old.md)`.");
        assert!(retarget("[w](https://a.b/c.md) [t](#top)", "A", "B", &none).is_none());
        assert_eq!(relative_to("A/B", "_images/x.png"), "../../_images/x.png");
        assert_eq!(note_link_paths("[a](<../My plan.md>) [b](قوائم/التسوق.md#x) [w](https://a.b/c.md) ![i](p.png)", "Work"), vec!["My plan.md", "Work/قوائم/التسوق.md"]);
    }
}
