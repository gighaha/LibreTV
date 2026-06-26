// cloud-sync.js - Cloud history sync via D1
const CloudSync = {
    API_BASE: '/api/history',
    _enabled: null,
    _syncTimer: null,

    async isEnabled() {
        if (this._enabled !== null) return this._enabled;
        try {
            const resp = await fetch(this.API_BASE + '/load', { method: 'GET' });
            this._enabled = resp.ok;
        } catch (e) {
            this._enabled = false;
        }
        return this._enabled;
    },

    async load() {
        if (!(await this.isEnabled())) return null;
        try {
            const resp = await fetch(this.API_BASE + '/load');
            const data = await resp.json();
            if (data.success && Array.isArray(data.history)) {
                return data.history;
            }
        } catch (e) {
            console.warn('[CloudSync] load failed:', e.message);
        }
        return null;
    },

    async sync(history) {
        if (!(await this.isEnabled()) || !Array.isArray(history)) return false;
        try {
            await fetch(this.API_BASE + '/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ history })
            });
            return true;
        } catch (e) {
            console.warn('[CloudSync] sync failed:', e.message);
            return false;
        }
    },

    async updateProgress(showId, position, duration) {
        if (!(await this.isEnabled()) || !showId) return;
        try {
            await fetch(this.API_BASE + '/progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showId, position, duration })
            });
        } catch (e) {
            console.warn('[CloudSync] progress sync failed:', e.message);
        }
    },

    async deleteItem(showId) {
        if (!(await this.isEnabled()) || !showId) return;
        try {
            await fetch(this.API_BASE + '/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showId })
            });
        } catch (e) {
            console.warn('[CloudSync] delete failed:', e.message);
        }
    },

    async clearAll() {
        if (!(await this.isEnabled())) return;
        try {
            await fetch(this.API_BASE + '/clear', { method: 'POST' });
        } catch (e) {
            console.warn('[CloudSync] clear failed:', e.message);
        }
    },

    debouncedSync(history) {
        if (this._syncTimer) clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => this.sync(history), 1000);
    }
};

window.CloudSync = CloudSync;
