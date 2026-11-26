The fonts the PDF writer embeds, as full TrueType files (the PDF needs real glyph outlines to subset; the app's own woff2 files cannot be):

- Roboto (Latin) — Apache License 2.0, from the @fontsource/roboto package.
- Noto Naskh Arabic UI and Noto Sans Arabic — SIL Open Font License 1.1, https://github.com/notofonts/arabic
- JetBrains Mono (a Latin, punctuation and box-drawing subset of the Nerd Font Mono build used in the app) — SIL Open Font License 1.1.

They are the same fonts as in `app/src/fonts`, converted with fonttools (`woff2` to `ttf`); the glyphs are unchanged.
