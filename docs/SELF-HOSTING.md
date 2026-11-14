# Self-hosting Qalamark

Qalamark is one container. It holds the server, the web app, and your notes.

## Docker Compose

```yaml
services:
  qalamark:
    image: ghcr.io/mmbesar/qalamark:latest
    container_name: qalamark
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      PUID: 1000            # the user that owns your notes (run `id` to see yours)
      PGID: 1000
      TZ: Africa/Cairo
      QALAMARK_SIGNUP: first   # "first": only the admin adds users. "open": anyone can sign up.
    volumes:
      - ./qalamark-data:/data
```

Start it with `docker compose up -d`, open `http://your-server:8080`, and
create the first account. **That account is the admin.**

## With Caddy (no ports, internal TLS)

Use the service from [`docker-compose.yml`](../docker-compose.yml), put it on the
same Docker network as Caddy, and add this to your Caddyfile:

```
qalamark.hs.lan {
    tls internal
    reverse_proxy qalamark:8080
}
```

Caddy passes WebSockets through by itself, so live editing just works.

## What is in the data folder

```
qalamark-data/
  notes/alice/Shopping.md      your notes: plain Markdown files, one folder per user
  notes/bob/Ideas.md
  trash/                       notes you deleted (kept, in case you want them back)
  qalamark.db                  accounts, sharing, and the co-editing history (small)
```

- **Back up** the whole folder, or just `notes/`. The text of every note is in the `.md` files.
- **Drop a `.md` file** into `notes/<username>/` and it shows up as a note.
- **Edit a file outside Qalamark** (Syncthing, a text editor): the change is merged into the note within a few seconds, even if someone has it open.
- A shared note's file stays in its **owner's** folder.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PUID`, `PGID` | `1000` | Who owns the files in `/data` |
| `TZ` | `UTC` | Time zone |
| `QALAMARK_SIGNUP` | `first` | `first` = only the first account is free, the admin adds others. `open` = anyone can create an account |
| `QALAMARK_ADDR` | `0.0.0.0:8080` | Address and port inside the container |
| `QALAMARK_DATA` | `/data` | Data folder inside the container |

## Behind a reverse proxy (HTTPS)

Put it behind any reverse proxy and make sure **WebSockets** are passed through
(live co-editing uses them, on the path `/ws/`). With Caddy that is automatic:

```
notes.example.com {
    reverse_proxy qalamark:8080
}
```

With Nginx add:

```
location /ws/ {
    proxy_pass http://qalamark:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}
```

Always use HTTPS on the internet: passwords and login tokens travel in the requests.

## Good to know

- Login tokens are stored hashed; passwords use argon2id.
- Reverse-proxy users: the server trusts nothing from headers; it has its own accounts.
- Not built yet: folders inside a user's notes, searching inside notes, creating notes while offline, version history. See the roadmap in the README.
