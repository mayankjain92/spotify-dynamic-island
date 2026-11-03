import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import GdkPixbuf from 'gi://GdkPixbuf';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [
        Math.max(0, Math.min(255, Math.round(r * 255))),
        Math.max(0, Math.min(255, Math.round(g * 255))),
        Math.max(0, Math.min(255, Math.round(b * 255))),
    ];
}

export class ColorHelper {
    constructor() {
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'spotify-dynamic-island', 'art']);
        GLib.mkdir_with_parents(this._cacheDir, 0o755);

        this._session = new Soup.Session();
        this._session.timeout = 8;
        this._session.user_agent = 'Mozilla/5.0 SpotifyDynamicIsland/1.0';

        this._cache = new Map();
    }

    async getCoverAndColor(artUrl) {
        if (!artUrl) {
            return this._defaultResult();
        }

        if (this._cache.has(artUrl)) {
            return this._cache.get(artUrl);
        }

        try {
            let filePath = null;

            if (artUrl.startsWith('file://')) {
                const localFile = Gio.File.new_for_uri(artUrl);
                filePath = localFile.get_path();
            } else if (artUrl.startsWith('http://') || artUrl.startsWith('https://')) {
                const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, artUrl, -1);
                filePath = GLib.build_filenamev([this._cacheDir, `${hash}.jpg`]);

                if (!GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
                    const msg = Soup.Message.new('GET', artUrl);
                    const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);

                    if (msg.status_code === 200 && bytes) {
                        const file = Gio.File.new_for_path(filePath);
                        file.replace_contents(bytes.get_data(), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                    } else {
                        return this._defaultResult();
                    }
                }
            } else {
                return this._defaultResult();
            }

            if (!filePath || !GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
                return this._defaultResult();
            }

            const colorData = this._extractDominantColor(filePath);
            const result = {
                path: filePath,
                uri: `file://${filePath}`,
                ...colorData,
            };

            this._cache.set(artUrl, result);
            return result;
        } catch (e) {
            console.warn(`[SpotifyDynamicIsland] ColorHelper error: ${e.message}`);
            return this._defaultResult();
        }
    }

    _extractDominantColor(filePath) {
        try {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(filePath);
            const thumb = pixbuf.scale_simple(16, 16, GdkPixbuf.InterpType.BILINEAR);
            const pixels = thumb.get_pixels();
            const nChannels = thumb.get_n_channels();
            const rowstride = thumb.get_rowstride();

            let bestR = 29, bestG = 185, bestB = 84;
            let maxScore = -1;
            let totalR = 0, totalG = 0, totalB = 0, count = 0;

            for (let y = 0; y < 16; y++) {
                for (let x = 0; x < 16; x++) {
                    const offset = y * rowstride + x * nChannels;
                    const r = pixels[offset];
                    const g = pixels[offset + 1];
                    const b = pixels[offset + 2];

                    totalR += r; totalG += g; totalB += b;
                    count++;

                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const delta = max - min;
                    const lightness = (max + min) / 2;

                    // Skip pure blacks, pure whites, or dull grays
                    if (lightness < 25 || lightness > 235 || delta < 20) continue;

                    const saturation = delta / (max || 1);
                    const score = saturation * (max / 255);

                    if (score > maxScore) {
                        maxScore = score;
                        bestR = r;
                        bestG = g;
                        bestB = b;
                    }
                }
            }

            if (maxScore < 0 && count > 0) {
                bestR = Math.max(30, Math.round(totalR / count));
                bestG = Math.max(30, Math.round(totalG / count));
                bestB = Math.max(30, Math.round(totalB / count));
            }

            // Boost color vibrancy so accents and gradients are rich and vivid
            const [h, s, l] = rgbToHsl(bestR, bestG, bestB);
            let vibrantR = bestR, vibrantG = bestG, vibrantB = bestB;

            if (s > 0.06) {
                // Elevate saturation into punchy 82-95% range
                const boostS = Math.min(1.0, Math.max(s * 1.45, 0.85));
                // Center lightness into vibrant sweet spot (48% - 56%)
                const boostL = Math.min(0.56, Math.max(0.48, l));
                [vibrantR, vibrantG, vibrantB] = hslToRgb(h, boostS, boostL);
            }

            return {
                r: vibrantR,
                g: vibrantG,
                b: vibrantB,
                rawR: bestR,
                rawG: bestG,
                rawB: bestB,
                rgbStr: `${vibrantR}, ${vibrantG}, ${vibrantB}`,
                hex: `#${vibrantR.toString(16).padStart(2, '0')}${vibrantG.toString(16).padStart(2, '0')}${vibrantB.toString(16).padStart(2, '0')}`,
            };
        } catch (e) {
            return this._defaultResult();
        }
    }

    _defaultResult() {
        return {
            path: null,
            uri: null,
            r: 29,
            g: 185,
            b: 84,
            rawR: 29,
            rawG: 185,
            rawB: 84,
            rgbStr: '29, 185, 84',
            hex: '#1db954',
        };
    }

    destroy() {
        this._cache.clear();
        if (this._session) {
            try { this._session.abort(); } catch (_) {}
            this._session = null;
        }
    }
}
