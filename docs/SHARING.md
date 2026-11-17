# Spaces, sharing and devices (plan)

Status: **planned**, not built yet. Written down so the design stays in one place.

## The idea in five lines

1. A **space** is a folder of plain `.md` files with a list of members. Nothing else holds your notes.
2. Everyone gets a **Personal** space. Anyone can make more (Family, Work, ...), unless an admin switches that off.
3. Members are added from the users list as **owner**, **editor** or **viewer**. Nobody joins until they **accept**
   the invitation, and an admin cannot add anyone for them.
4. After accepting, the space is in your account. **Each device chooses** whether to keep it (in a folder) or not at all.
5. Everything works offline and syncs when the server is back. Live co-editing stays.

## Server

```
data/
├── qalamark.db        accounts, memberships, invitations, shares of single notes
├── spaces/
│   ├── mohammed/      personal space of the user "mohammed"
│   ├── Family/        a shared space
│   └── Work/
└── trash/
```

- A space is one plain folder. Names are unique across the server (a space cannot be named like a user).
- Membership lives in the database. Back up the folders **and** the database file.
- Today's `data/notes/<user>/` moves to `data/spaces/<user>/`; the files are not changed.

## Device and app (same tree)

```
Documents/Qalamark/
├── Personal/          your personal space
├── Family/            a shared space kept on this device
└── Shared with me/    single notes shared with you (only when kept offline)
```

- Only spaces kept on that device are there. The web app shows every space you belong to.
- The app never renames your folders. A space is matched by id, not by folder name.
- A folder that moved or was renamed outside the app is linked again with **Choose folder**.

## Rules

- **Invitations:** pending until accepted; nothing is shown or downloaded before. Declining or leaving is always possible;
  a leaver keeps a local copy.
- **Links:** `[[Note]]` is the default and finds notes by name inside the space; `[[Space/Folder/Note]]` reaches across
  spaces. Standard Markdown links are an option. Inserting a link from a shared space to a note outside it warns.
- **Search:** everywhere by default, narrowed to one space on request; results show the space.
- **Settings:** per device for now.
- **Safety:** version history comes before shared spaces open up; deletes go to the trash.

## Order of work

1. Notes folder on Android (`Documents/Qalamark`), first-start choice, sign-out behaviour. *(done)*
2. Spaces on the server, the move to `data/spaces/`, the Personal view.
3. Invitations, membership, admin panel for spaces.
4. Version history, then offline rules for shared spaces.
