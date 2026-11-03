import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const decode = (bytes) => new TextDecoder().decode(bytes.get_data());

export class LyricsClient {
    constructor() {
        this._session = new Soup.Session();
        this._session.timeout = 8;
        this._cache = new Map();
    }

    // ========= FETCH ENGINE =========
    async getLyrics(title, artist, album = '', durationSec = 0) {
        if (!title || !this._session) return null;

        const cacheKey = `${title.toLowerCase()}:::${artist.toLowerCase()}`;
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        try {
            // Clean title for search
            const cleanTitle = title.replace(/\s*\(feat\..*?\)/gi, '')
                                    .replace(/\s*\[feat\..*?\]/gi, '')
                                    .replace(/\s*\(from.*?\)/gi, '')
                                    .replace(/\s*\[from.*?\]/gi, '')
                                    .replace(/\s*-\s*Bonus Track.*/gi, '')
                                    .replace(/\s*-\s*Remastered.*/gi, '')
                                    .replace(/\s*-\s*From .*/gi, '')
                                    .trim();
            const cleanArtist = artist.split(',')[0].split('&')[0].trim();

            let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
            if (album) url += `&album_name=${encodeURIComponent(album)}`;
            if (durationSec > 0) url += `&duration=${Math.round(durationSec)}`;

            const msg = Soup.Message.new('GET', url);
            const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);

            if (msg.status_code === Soup.Status.OK) {
                const data = JSON.parse(decode(bytes));
                if (data.syncedLyrics) {
                    const parsed = this._parseLRC(data.syncedLyrics);
                    if (parsed && parsed.length > 0) {
                        this._cache.set(cacheKey, parsed);
                        return parsed;
                    }
                }
            }

            // Fallback search
            const searchResult = await this._searchLyrics(cleanTitle, cleanArtist, durationSec);
            if (searchResult && searchResult.length > 0) {
                this._cache.set(cacheKey, searchResult);
                return searchResult;
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    // ========= SEARCH FALLBACK =========
    async _searchLyrics(title, artist, durationSec) {
        if (!this._session) return null;
        try {
            const query = `${title} ${artist}`.trim();
            const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
            const msg = Soup.Message.new('GET', url);
            const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);

            if (msg.status_code !== Soup.Status.OK) return null;

            const data = JSON.parse(decode(bytes));
            if (!Array.isArray(data) || data.length === 0) return null;

            let match = null;
            if (durationSec > 0) {
                match = data.find(item => item.syncedLyrics && Math.abs(item.duration - durationSec) < 4);
            }
            if (!match) {
                match = data.find(item => item.syncedLyrics);
            }

            return match?.syncedLyrics ? this._parseLRC(match.syncedLyrics) : null;
        } catch (e) {
            return null;
        }
    }

    // ========= LRC PARSER =========
    _parseLRC(lrcText) {
        const lines = [];
        const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
        lrcText.split('\n').forEach(line => {
            const match = line.match(regex);
            if (match) {
                const time = (parseInt(match[1], 10) * 60 * 1000) +
                             (parseInt(match[2], 10) * 1000) +
                             (parseFloat('0.' + match[3]) * 1000);
                const text = match[4].trim();
                if (text) {
                    lines.push({ time, text });
                }
            }
        });
        return lines;
    }

    destroy() {
        if (this._session) {
            try { this._session.abort(); } catch (_) {}
            this._session = null;
        }
        this._cache.clear();
    }
}
