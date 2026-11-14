# Store screenshots: what to capture (5 images, 1280x800)

The store wants 1 to 5 screenshots. Use the DEMO setup (fake account maya@example.com, sample drawings) so none of your own data shows.
Chrome window about 1280x800, bookmarks bar hidden (Shift+Cmd+B), dark or light as you prefer (use the same for all five).

Take each one with Shift+Cmd+4, then Space, then click the Chrome window (this captures the whole window, side panel included). Save them all in one folder, named 1, 2, 3, 4, 5 in this order.

| # | Show | Why it sells it |
|---|------|-----------------|
| 1 | Side panel open on the file list, with the "Product launch plan" drawing on the canvas, Inkdrive button visible top right | The main picture: drawings in the cloud, right beside the canvas |
| 2 | The sign-in screen in the side panel (the hand-drawn art and "Continue with Google") | Shows sign-in is just Google |
| 3 | File list with a folder open, a tag chip visible, and something typed in Search | Folders, tags, search |
| 4 | A file's "..." menu open (Rename, Tags, Make a copy, Download, Version history) | Everything you can do |
| 5 | The Version history dialog with a few revisions | Go back to an older version |

Then make them exact size:

```bash
cd apps/extension
node scripts/fit-screenshots.mjs ~/Desktop/inkdrive-shots
```

The finished files appear in `store/screenshots/`. Upload those in the store listing. Do not edit them to show features that do not exist.
