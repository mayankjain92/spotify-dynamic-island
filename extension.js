import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ColorHelper } from './colorHelper.js';
import { MprisManager } from './mpris.js';
import { LyricsClient } from './lyricsClient.js';
import { DynamicIslandIndicator } from './panelPill.js';

export default class SpotifyDynamicIslandExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.spotify-dynamic-island');
        this._colorHelper = new ColorHelper();
        this._lyricsClient = new LyricsClient();

        // 1. Setup MPRIS manager with onStateChanged, onSeeked, and settings
        this._mpris = new MprisManager(
            info => {
                if (this._indicator) {
                    this._indicator.update(info);
                }
            },
            position => {
                if (this._indicator) {
                    this._indicator.syncPosition(position);
                }
            },
            this._settings
        );

        // 2. Setup indicator in requested panel position
        this._setupIndicator();

        // 3. Listen to panel position changes from Preferences
        this._posSettingId = this._settings.connect('changed::pill-position', () => {
            this._reloadIndicator();
        });
    }

    _setupIndicator() {
        this._indicator = new DynamicIslandIndicator(
            this._mpris,
            this._colorHelper,
            this._lyricsClient,
            this._settings
        );

        const pos = this._settings ? this._settings.get_string('pill-position') : 'center';
        const section = (pos === 'left') ? 'left' : (pos === 'right') ? 'right' : 'center';

        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, section);

        // Initial sync
        const initialInfo = this._mpris.getInfo();
        this._indicator.update(initialInfo);
    }

    _reloadIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._setupIndicator();
    }

    disable() {
        if (this._posSettingId && this._settings) {
            this._settings.disconnect(this._posSettingId);
            this._posSettingId = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._mpris) {
            this._mpris.destroy();
            this._mpris = null;
        }

        if (this._colorHelper) {
            this._colorHelper.destroy();
            this._colorHelper = null;
        }

        if (this._lyricsClient) {
            this._lyricsClient.destroy();
            this._lyricsClient = null;
        }

        this._settings = null;
    }
}
