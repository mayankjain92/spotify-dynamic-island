import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpotifyDynamicIslandPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.spotify-dynamic-island');

        // Window configuration
        window.set_default_size(660, 520);

        // Page: General
        const page = new Adw.PreferencesPage({
            title: 'Dynamic Island',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // =====================================================================
        // Group 1: Top Bar Dynamic Island Pill
        // =====================================================================
        const pillGroup = new Adw.PreferencesGroup({
            title: 'Top Bar Dynamic Island',
            description: 'Customize the compact pill appearance and position in the GNOME top bar',
        });
        page.add(pillGroup);

        // 0. Target Player Compatibility
        const playerRow = new Adw.ComboRow({
            title: 'Target Player',
            subtitle: 'Choose which media players are handled by the Dynamic Island',
            model: new Gtk.StringList({
                strings: ['All Media Players (Spotify Prioritized)', 'Spotify Exclusively'],
            }),
        });
        const playerValues = ['all', 'spotify'];
        const currentTarget = settings.get_string('target-player');
        const targetIdx = playerValues.indexOf(currentTarget);
        playerRow.selected = targetIdx !== -1 ? targetIdx : 0;
        playerRow.connect('notify::selected', () => {
            const chosen = playerValues[playerRow.selected];
            if (chosen && chosen !== settings.get_string('target-player')) {
                settings.set_string('target-player', chosen);
            }
        });
        pillGroup.add(playerRow);

        // 1. Pill Position
        const posRow = new Adw.ComboRow({
            title: 'Pill Position',
            subtitle: 'Placement of the Dynamic Island indicator in the top panel',
            model: new Gtk.StringList({ strings: ['Center', 'Left', 'Right'] }),
        });
        const posValues = ['center', 'left', 'right'];
        const currentPos = settings.get_string('pill-position');
        const posIdx = posValues.indexOf(currentPos);
        posRow.selected = posIdx !== -1 ? posIdx : 0;
        posRow.connect('notify::selected', () => {
            const chosen = posValues[posRow.selected];
            if (chosen && chosen !== settings.get_string('pill-position')) {
                settings.set_string('pill-position', chosen);
            }
        });
        pillGroup.add(posRow);

        // 2. Pill Display Mode
        const modeRow = new Adw.ComboRow({
            title: 'Pill Display Mode',
            subtitle: 'Content displayed in the compact pill during playback',
            model: new Gtk.StringList({
                strings: ['Live Singing Lyrics (Apple Music style)', 'Song Title & Artist'],
            }),
        });
        const modeValues = ['lyrics', 'title'];
        const currentMode = settings.get_string('pill-display-mode');
        const modeIdx = modeValues.indexOf(currentMode);
        modeRow.selected = modeIdx !== -1 ? modeIdx : 0;
        modeRow.connect('notify::selected', () => {
            const chosen = modeValues[modeRow.selected];
            if (chosen && chosen !== settings.get_string('pill-display-mode')) {
                settings.set_string('pill-display-mode', chosen);
            }
        });
        pillGroup.add(modeRow);

        // 3. Visualizer Dancing Bars
        const eqRow = new Adw.SwitchRow({
            title: 'Equalizer Visualizer Bars',
            subtitle: 'Display animated 3-bar sound visualizer on the compact pill',
        });
        settings.bind('show-visualizer', eqRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        pillGroup.add(eqRow);

        // 4. Pill Ambient Art Tint
        const ambientRow = new Adw.SwitchRow({
            title: 'Ambient Art Color Scheme',
            subtitle: 'Infuse the compact pill and visualizer with the album art dominant color',
        });
        settings.bind('enable-ambient-glow', ambientRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        pillGroup.add(ambientRow);

        // =====================================================================
        // Group 2: Expanded Island Card
        // =====================================================================
        const cardGroup = new Adw.PreferencesGroup({
            title: 'Expanded Island Card',
            description: 'Styling and visuals for the dropdown music controller card',
        });
        page.add(cardGroup);

        // 5. Card Background Style
        const bgStyleRow = new Adw.ComboRow({
            title: 'Card Background Style',
            subtitle: 'Background visual effect applied inside the expanded card',
            model: new Gtk.StringList({
                strings: [
                    'Album Cover Art with Vignette Fade',
                    'Vibrant Ambient Color Gradient',
                    'Pure OLED Pitch Black',
                ],
            }),
        });
        const bgStyleValues = ['cover-art', 'ambient', 'black'];
        const currentBgStyle = settings.get_string('card-background-style');
        const bgStyleIdx = bgStyleValues.indexOf(currentBgStyle);
        bgStyleRow.selected = bgStyleIdx !== -1 ? bgStyleIdx : 0;
        bgStyleRow.connect('notify::selected', () => {
            const chosen = bgStyleValues[bgStyleRow.selected];
            if (chosen && chosen !== settings.get_string('card-background-style')) {
                settings.set_string('card-background-style', chosen);
            }
        });
        cardGroup.add(bgStyleRow);

        // =====================================================================
        // Group 3: Music Scrubber & Progress Bar
        // =====================================================================
        const scrubberGroup = new Adw.PreferencesGroup({
            title: 'Music Progress & Scrubber',
            description: 'Progress bar style and audio animations',
        });
        page.add(scrubberGroup);

        // 6. Progress Scrubber Style (Samsung OneUI squiggly sound wave vs Apple straight)
        const progressStyleRow = new Adw.ComboRow({
            title: 'Scrubber Animation Style',
            subtitle: 'Sound-reactive squiggly wave (Samsung OneUI / Android) or sleek straight line',
            model: new Gtk.StringList({
                strings: [
                    'Samsung OneUI Sound-Reactive Wave',
                    'Apple Sleek Straight Line',
                ],
            }),
        });
        const progressStyleValues = ['wavy', 'straight'];
        const currentProgressStyle = settings.get_string('progress-style');
        const progressStyleIdx = progressStyleValues.indexOf(currentProgressStyle);
        progressStyleRow.selected = progressStyleIdx !== -1 ? progressStyleIdx : 0;
        progressStyleRow.connect('notify::selected', () => {
            const chosen = progressStyleValues[progressStyleRow.selected];
            if (chosen && chosen !== settings.get_string('progress-style')) {
                settings.set_string('progress-style', chosen);
            }
        });
        scrubberGroup.add(progressStyleRow);
    }
}
