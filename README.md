# Spotify Dynamic Island for GNOME Shell

An Apple-inspired Dynamic Island pill and expanded media controller for Spotify and universal MPRIS players in GNOME Shell.

![Dynamic Island Preview](preview.png)

## Features

- **Dynamic Island Top Bar Pill:** Compact, sleek pill in the top bar displaying current track info or live singing lyrics, with sound-reactive equalizer animations.
- **Album Art Vignette Background:** The expanded card displays the actual album cover art with smooth top and bottom vertical vignette gradients fading into pure pitch black, keeping all text, sliders, and controls razor-sharp and easily readable.
- **Samsung OneUI Sound-Reactive Scrubber:** Smooth, sound-reactive undulating waveform that animates during playback and flattens into a straight bar when paused or dragged.
- **Synchronized Lyrics:** Apple Music style live synchronized scrolling lyrics powered by lrclib.net with click-to-seek support.
- **Universal MPRIS Player Fallback:** Spotify is prioritized as the primary player, but the extension seamlessly falls back to other running media players (YouTube Music desktop, Chrome/Firefox tabs, Amberol, VLC, Brave) when Spotify is inactive.
- **Ambient Color Palette:** Dynamically samples vibrant dominant colors from album art to tint keyline rims and visualizers.
- **Native Preferences Window:** Built with Libadwaita (`Adw.PreferencesWindow`) to customize panel position, display modes, progress bar styles, and background visuals.

## Compatibility

- **GNOME Shell:** 45, 46, 47
- **Display Server:** Wayland & X11

## Installation

### From Source

1. Clone or copy this repository to your local GNOME extensions directory:
   ```bash
   git clone https://github.com/mayankjain92/spotify-dynamic-island.git ~/.local/share/gnome-shell/extensions/spotify-dynamic-island@mayankjain92.github.io
   ```

2. Compile the GSettings schemas:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/spotify-dynamic-island@mayankjain92.github.io/schemas
   ```

3. Enable the extension:
   ```bash
   gnome-extensions enable spotify-dynamic-island@mayankjain92.github.io
   ```

4. Open preferences:
   ```bash
   gnome-extensions prefs spotify-dynamic-island@mayankjain92.github.io
   ```

## License

GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
