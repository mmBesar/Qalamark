// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// The notes folder: plain .md files on disk. Std only, so it can be tested on its own.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, PartialEq, Eq)]
pub struct FileInfo {
    /// Path inside the vault, always with `/` separators.
    pub path: String,
    pub mtime_ms: u64,
}

/// Turns "Folder/Note.md" into a safe path under `root`; refuses anything that could escape it.
pub fn resolve(root: &Path, rel: &str) -> io::Result<PathBuf> {
    resolve_ext(root, rel, &[".md"])
}

/// Like `resolve`, for the other kinds of file the app puts next to notes (a PDF export, later pictures).
pub fn resolve_ext(root: &Path, rel: &str, exts: &[&str]) -> io::Result<PathBuf> {
    let bad = |m: &str| io::Error::new(io::ErrorKind::InvalidInput, m.to_string());
    let low = rel.to_lowercase();
    if rel.is_empty() || !exts.iter().any(|e| low.ends_with(e)) {
        return Err(bad("this kind of file is not allowed"));
    }
    let mut out = root.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(p) => {
                let s = p.to_string_lossy();
                if s.starts_with('.') {
                    return Err(bad("hidden names are not allowed"));
                }
                out.push(p);
            }
            _ => return Err(bad("path must stay inside the notes folder")),
        }
    }
    Ok(out)
}

fn mtime(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Every .md file under the vault (hidden folders such as .trash are skipped).
pub fn list(root: &Path) -> io::Result<Vec<FileInfo>> {
    fs::create_dir_all(root)?;
    let mut out = Vec::new();
    walk(root, root, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<FileInfo>) -> io::Result<()> {
    for e in fs::read_dir(dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let p = e.path();
        let ft = e.file_type()?;
        if ft.is_dir() {
            walk(root, &p, out)?;
        } else if ft.is_file() && name.to_lowercase().ends_with(".md") {
            let rel = p.strip_prefix(root).unwrap_or(&p).components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
            out.push(FileInfo { path: rel, mtime_ms: mtime(&p) });
        }
    }
    Ok(())
}

pub fn read(root: &Path, rel: &str) -> io::Result<(String, u64)> {
    let p = resolve(root, rel)?;
    Ok((fs::read_to_string(&p)?, mtime(&p)))
}

/// Writes through a temporary file so a crash never leaves half a note. Returns the new mtime.
pub fn write(root: &Path, rel: &str, text: &str) -> io::Result<u64> {
    let p = resolve(root, rel)?;
    if let Some(d) = p.parent() {
        fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("md.qalamark-tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &p)?;
    Ok(mtime(&p))
}

/// The files the app keeps next to notes besides the notes themselves: a PDF made from one, and pictures.
const EXTRA: [&str; 8] = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"];

/// Writes a file that is not a note (a PDF made from one, a picture) next to it. Same safety rules as notes.
pub fn write_file(root: &Path, rel: &str, bytes: &[u8]) -> io::Result<u64> {
    let p = resolve_ext(root, rel, &EXTRA)?;
    if let Some(d) = p.parent() {
        fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("qalamark-tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, &p)?;
    Ok(mtime(&p))
}

/// Reads one of those files back (a picture to show). `None` when it is not there.
pub fn read_file(root: &Path, rel: &str) -> io::Result<Option<Vec<u8>>> {
    let p = resolve_ext(root, rel, &EXTRA)?;
    match fs::read(&p) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Moves a note to `.trash` inside the vault instead of deleting it for good.
pub fn trash(root: &Path, rel: &str) -> io::Result<()> {
    let p = resolve(root, rel)?;
    if !p.exists() {
        return Ok(());
    }
    let dir = root.join(".trash");
    fs::create_dir_all(&dir)?;
    let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "note.md".into());
    fs::rename(&p, dir.join(format!("{stamp}-{name}")))
}

/// Renames or moves a note. Refuses to overwrite another file.
pub fn rename(root: &Path, from: &str, to: &str) -> io::Result<u64> {
    let a = resolve(root, from)?;
    let b = resolve(root, to)?;
    if !a.exists() || a == b {
        return Ok(mtime(&a));
    }
    if b.exists() {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, "a note with that name already exists"));
    }
    if let Some(d) = b.parent() {
        fs::create_dir_all(d)?;
    }
    fs::rename(&a, &b)?;
    Ok(mtime(&b))
}

pub fn mkdir(root: &Path, folder: &str) -> io::Result<()> {
    let p = resolve(root, &format!("{}/x.md", folder.trim_matches('/')))?;
    fs::create_dir_all(p.parent().unwrap_or(root))
}

/// Where notes live when nothing was chosen: Documents/Qalamark, or the app's own folder when
/// the system has no Documents folder (some phones).
pub fn default_dir(documents: Option<PathBuf>, fallback: PathBuf) -> PathBuf {
    documents.map(|d| d.join("Qalamark")).unwrap_or_else(|| fallback.join("Qalamark"))
}

/// Can files be created in this folder? (Android only lets the app into Documents once "all files" access is granted.)
#[allow(dead_code)]
pub fn usable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".qalamark-probe");
    let ok = fs::write(&probe, b"ok").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

#[allow(dead_code)]
fn has_notes(dir: &Path) -> bool {
    fs::read_dir(dir).map(|d| d.flatten().any(|e| {
        let p = e.path();
        (p.is_file() && p.extension().is_some_and(|x| x == "md")) || (p.is_dir() && !e.file_name().to_string_lossy().starts_with('.') && has_notes(&p))
    })).unwrap_or(false)
}

/// Copy everything from `from` into `to` (never overwriting). Used once, when the notes folder moves
/// from the app's private place to Documents/Qalamark.
#[allow(dead_code)]
pub fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)?.flatten() {
        let (a, b) = (e.path(), to.join(e.file_name()));
        if a.is_dir() {
            copy_tree(&a, &b)?;
        } else if !b.exists() {
            fs::copy(&a, &b)?;
        }
    }
    Ok(())
}

/// Bring notes made in the old private folder along when the shared one becomes usable and has none yet.
#[allow(dead_code)]
pub fn adopt(old: &Path, new: &Path) {
    if old != new && has_notes(old) && !has_notes(new) {
        let _ = copy_tree(old, new);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("qalamark-vault-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn pictures_go_in_the_images_folder_and_come_back() {
        let r = tmp("img");
        write_file(&r, "_images/3f9a.png", b"\x89PNG").unwrap();
        assert_eq!(read_file(&r, "_images/3f9a.png").unwrap().unwrap(), b"\x89PNG");
        assert!(read_file(&r, "_images/none.png").unwrap().is_none());
        assert!(read_file(&r, "../_images/3f9a.png").is_err());
        assert!(read_file(&r, "Work/note.md").is_err(), "notes have their own door");
        assert_eq!(list(&r).unwrap().len(), 0, "pictures are not notes");
    }

    #[test]
    fn a_pdf_is_written_next_to_its_note_and_nothing_else_is() {
        let r = tmp("pdf");
        write_file(&r, "Work/Invoice.pdf", b"%PDF-1.7 test").unwrap();
        assert_eq!(fs::read(r.join("Work/Invoice.pdf")).unwrap(), b"%PDF-1.7 test");
        write_file(&r, "Work/Invoice.pdf", b"%PDF-1.7 again").unwrap(); // replaced, no leftovers
        assert_eq!(fs::read_dir(r.join("Work")).unwrap().count(), 1);
        assert!(write_file(&r, "../Evil.pdf", b"x").is_err(), "cannot leave the notes folder");
        assert!(write_file(&r, "Work/run.sh", b"x").is_err(), "only PDFs and pictures");
        assert!(write_file(&r, "Work/note.md", b"x").is_err(), "notes go through their own door");
    }

    #[test]
    fn paths_cannot_escape() {
        let r = tmp("esc");
        assert!(resolve(&r, "a/b.md").is_ok());
        assert!(resolve(&r, "../x.md").is_err());
        assert!(resolve(&r, "/etc/x.md").is_err());
        assert!(resolve(&r, "a/../../x.md").is_err());
        assert!(resolve(&r, ".trash/x.md").is_err());
        assert!(resolve(&r, "a/b.txt").is_err());
        assert!(resolve(&r, "").is_err());
    }

    #[test]
    fn write_read_list_rename_trash() {
        let r = tmp("rw");
        write(&r, "Groceries.md", "milk").unwrap();
        write(&r, "Work/Plan.md", "# Plan").unwrap();
        fs::write(r.join("ignore.txt"), "x").unwrap();
        let l = list(&r).unwrap();
        assert_eq!(l.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["Groceries.md", "Work/Plan.md"]);
        assert_eq!(read(&r, "Work/Plan.md").unwrap().0, "# Plan");
        rename(&r, "Work/Plan.md", "Plans/Big plan.md").unwrap();
        assert!(!r.join("Work/Plan.md").exists() && r.join("Plans/Big plan.md").exists());
        write(&r, "Other.md", "o").unwrap();
        assert!(rename(&r, "Other.md", "Groceries.md").is_err()); // never overwrites
        trash(&r, "Groceries.md").unwrap();
        assert!(!r.join("Groceries.md").exists());
        assert_eq!(list(&r).unwrap().len(), 2); // .trash is not listed
        assert_eq!(fs::read_dir(r.join(".trash")).unwrap().count(), 1);
        mkdir(&r, "Empty folder").unwrap();
        assert!(r.join("Empty folder").is_dir());
    }

    #[test]
    fn adopting_copies_old_notes_once() {
        let (a, b) = (tmp("adopt-a"), tmp("adopt-b"));
        fs::create_dir_all(a.join("F")).unwrap();
        fs::write(a.join("F/x.md"), "hi").unwrap();
        assert!(usable(&b));
        adopt(&a, &b);
        assert_eq!(fs::read_to_string(b.join("F/x.md")).unwrap(), "hi");
        fs::write(b.join("F/x.md"), "edited").unwrap();
        adopt(&a, &b); // the new folder has notes now: leave it alone
        assert_eq!(fs::read_to_string(b.join("F/x.md")).unwrap(), "edited");
        assert!(!usable(Path::new("/proc/qalamark-no")));
    }

    #[test]
    fn default_location() {
        assert_eq!(default_dir(Some(PathBuf::from("/home/u/Documents")), PathBuf::from("/data")), PathBuf::from("/home/u/Documents/Qalamark"));
        assert_eq!(default_dir(None, PathBuf::from("/data")), PathBuf::from("/data/Qalamark"));
    }
}
