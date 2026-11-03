import GObject from 'gi://GObject';
import St from 'gi://St';
import PangoCairo from 'gi://PangoCairo';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

export const LyricsWidget = GObject.registerClass({
    GTypeName: 'DynamicIslandLyricsWidget',
}, class LyricsWidget extends St.DrawingArea {
    _init(onSeek) {
        super._init({
            style_class: 'lyrics-widget',
            reactive: true,
            can_focus: false,
            x_expand: true,
            y_expand: false,
            height: 160,
        });

        this._onSeek = onSeek;
        this._lyrics = [];
        this._lineGeometries = [];
        this._totalHeight = 0;

        this._activeIndex = -1;
        this._currentTime = 0;

        this._scrollOffset = 0;
        this._targetScrollOffset = 0;
        this._tickId = 0;

        this._state = 'loading';

        this._config = {
            activeColor: { r: 1, g: 1, b: 1, a: 1 },
            neighborColor: { r: 1, g: 1, b: 1, a: 0.60 },
            inactiveColor: { r: 1, g: 1, b: 1, a: 0.28 },
            activeSize: 15,
            neighborSize: 13,
            inactiveSize: 11,
            spacing: 8,
        };

        this.connect('button-press-event', (actor, event) => {
            const [, clickY] = event.get_coords();
            const [success, , localY] = this.transform_stage_point(0, clickY);
            if (success && this._lineGeometries.length > 0) {
                const targetY = localY + this._scrollOffset;
                const match = this._lineGeometries.find(g => targetY >= g.y && targetY <= (g.y + g.height));
                if (match && typeof match.time === 'number' && this._onSeek) {
                    this._onSeek(match.time);
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    showLoading() {
        this._state = 'loading';
        this._lyrics = [];
        this._activeIndex = -1;
        this.queue_repaint();
    }

    showEmpty(msg = 'No Lyrics Found') {
        this._state = 'empty';
        this._emptyMsg = msg;
        this._lyrics = [];
        this._activeIndex = -1;
        this.queue_repaint();
    }

    setLyrics(lyrics) {
        if (!lyrics || lyrics.length === 0) {
            this.showEmpty();
            return;
        }

        this._state = 'lyrics';
        this._lyrics = lyrics;
        this._activeIndex = -1;
        this._currentTime = 0;
        this._scrollOffset = 0;
        this._targetScrollOffset = 0;
        this._lineGeometries = [];
        this.queue_repaint();
    }

    getActiveText() {
        if (this._state === 'lyrics' && this._activeIndex >= 0 && this._lyrics[this._activeIndex]) {
            return this._lyrics[this._activeIndex].text;
        }
        return null;
    }

    updatePosition(timeInMs) {
        if (this._state !== 'lyrics' || this._lyrics.length === 0) return;

        this._currentTime = timeInMs;

        let newIndex = -1;
        for (let i = 0; i < this._lyrics.length; i++) {
            if (this._lyrics[i].time <= timeInMs) {
                newIndex = i;
            } else {
                break;
            }
        }

        if (this._activeIndex !== newIndex) {
            this._activeIndex = newIndex;
            this._startAnimation();
            this.queue_repaint();
        }
    }

    _startAnimation() {
        if (this._tickId) return;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => this._onTick());
    }

    _onTick() {
        const diff = this._targetScrollOffset - this._scrollOffset;
        if (Math.abs(diff) < 0.5) {
            this._scrollOffset = this._targetScrollOffset;
            this.queue_repaint();
            this._tickId = 0;
            return GLib.SOURCE_REMOVE;
        }
        this._scrollOffset += diff * 0.08;
        this.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }

        const layout = PangoCairo.create_layout(cr);

        if (this._state !== 'lyrics') {
            const text = this._state === 'loading' ? 'Searching lyrics...' : (this._emptyMsg || 'No Lyrics Found');
            layout.set_text(text, -1);
            layout.set_alignment(Pango.Alignment.CENTER);

            const font = Pango.FontDescription.from_string(`Inter, -apple-system, Sans 13`);
            layout.set_font_description(font);

            const [, logical] = layout.get_extents();
            const textWidth = logical.width / Pango.SCALE;
            const textHeight = logical.height / Pango.SCALE;

            cr.setSourceRGBA(1.0, 1.0, 1.0, 0.45);
            cr.moveTo((width - textWidth) / 2, (height - textHeight) / 2);
            PangoCairo.show_layout(cr, layout);
            cr.$dispose();
            return;
        }

        const PADDING_X = 16;
        const TEXT_WIDTH = Math.max(10, width - (PADDING_X * 2));

        layout.set_width(TEXT_WIDTH * Pango.SCALE);
        layout.set_wrap(Pango.WrapMode.WORD_CHAR);
        layout.set_alignment(Pango.Alignment.CENTER);

        this._lineGeometries = [];
        let cursorY = 0;

        this._lyrics.forEach((line, index) => {
            const active = index === this._activeIndex;
            const neighbor = Math.abs(index - this._activeIndex) === 1;

            let fontSize = this._config.inactiveSize;
            let weight = 'Normal';
            if (active) {
                fontSize = this._config.activeSize;
                weight = 'Bold';
            } else if (neighbor) {
                fontSize = this._config.neighborSize;
                weight = 'Medium';
            }

            const font = Pango.FontDescription.from_string(`Inter, -apple-system, Sans ${weight} ${fontSize}`);
            layout.set_font_description(font);
            layout.set_text(line.text, -1);

            const [, logical] = layout.get_extents();
            const textHeight = logical.height / Pango.SCALE;

            this._lineGeometries.push({
                y: cursorY,
                height: textHeight,
                text: line.text,
                time: line.time,
                font,
                active,
                neighbor,
            });

            cursorY += textHeight + this._config.spacing;
        });

        this._totalHeight = Math.max(cursorY - this._config.spacing, 0);

        if (this._activeIndex >= 0) {
            const geo = this._lineGeometries[this._activeIndex];
            if (geo) {
                const maxScroll = Math.max(0, this._totalHeight - height);
                const target = (geo.y + geo.height / 2) - (height / 2);
                this._targetScrollOffset = Math.min(Math.max(target, 0), maxScroll);
            }
        }

        // Draw visible lines
        this._lineGeometries.forEach(geo => {
            const y = geo.y - this._scrollOffset;
            if (y + geo.height < -20 || y > height + 20) return;

            layout.set_font_description(geo.font);
            layout.set_text(geo.text, -1);

            if (geo.active) {
                const c = this._config.activeColor;
                cr.setSourceRGBA(c.r, c.g, c.b, c.a);
            } else if (geo.neighbor) {
                const c = this._config.neighborColor;
                cr.setSourceRGBA(c.r, c.g, c.b, c.a);
            } else {
                const c = this._config.inactiveColor;
                cr.setSourceRGBA(c.r, c.g, c.b, c.a);
            }

            cr.moveTo(PADDING_X, y);
            PangoCairo.show_layout(cr, layout);
        });

        cr.$dispose();
    }

    destroy() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        super.destroy();
    }
});
