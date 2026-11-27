# Desktop plugins

Open **Window > Plugins** to see detected packages and enable or disable each one. New packages start disabled. Splash Animator remembers enable choices for each plugin folder. The app scans when you open the dialog. Use **Scan again** if you add a package while it is open.

The default folder is `plugins` beside the desktop executable or Linux AppImage. Create it if needed. To use a different folder, open **File > Preferences > Plugins** and choose an existing folder. This is also how to use plugins when the installation directory is read-only. **Use default** restores the executable-relative location.

Place each package in its own direct child folder. For example, `plugins/example-tools/plugin.json` could contain:

```json
{
  "id": "example.tools",
  "name": "Example Tools",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Example plugin metadata"
}
```

`description` is optional. IDs are dot-separated lowercase names whose segments begin with an ASCII letter and may contain digits and hyphens. All copies of a duplicate ID are withheld, and scan issues appear alongside valid results. The scanner accepts API version 1, reads up to 16 KiB per manifest, and admits up to 512 entries in the plugin folder.

This version discovers packages and records enable choices. Plugin execution and developer APIs will be added separately.
