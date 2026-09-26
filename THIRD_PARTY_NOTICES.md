# Third-party notices

General Battle System is licensed under GPL-3.0-only for material the project has the right to license. Third-party components retain their own licenses.

- **JEV command core**: copyright holder smokycamera has relicensed the copy in `vendor/jev-core` under GPL-3.0-only for this repository. Its exact source revision, original upstream license, current license and file hashes are recorded in `vendor/jev-core/source.json`. The separate upstream repository is not modified by this relicensing. Game-specific adapters stay outside this copy.

- **Vite** (MIT): the production build includes its generated module preload helpers. The complete Vite license distribution, including its bundled dependency notices, is preserved in `licenses/Vite-LICENSE.md`.
- **TypeScript** (Apache-2.0), **Vitest** (MIT), **Playwright Core** (Apache-2.0), **vite-plugin-singlefile** (MIT): development, build or validation tools. Their packages and license files are provided by npm according to `package-lock.json`; the extension does not bundle their test or compiler implementations.
- **SillyTavern**, **TauriTavern** and **TavernHelper / JS-Slash-Runner** are separate host or companion projects. Their application code is not distributed as part of the native extension. The names identify interoperability and tested environments; they do not imply affiliation or endorsement.

The isolated host applications, test profiles, generated chats, credentials, and browser binaries used in validation are excluded from this repository and release archives.
