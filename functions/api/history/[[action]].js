export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const action = pathParts[pathParts.length - 1];

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const db = env.DB;
    if (!db) {
        return Response.json({ success: false, error: 'D1 not bound' }, { status: 500, headers: corsHeaders });
    }

    try {
        switch (action) {
            case 'load': {
                const { results } = await db.prepare(
                    'SELECT * FROM watch_history ORDER BY timestamp DESC LIMIT 50'
                ).all();
                const history = results.map(r => ({
                    title: r.title,
                    directVideoUrl: r.direct_video_url,
                    url: r.url,
                    episodeIndex: r.episode_index,
                    sourceName: r.source_name,
                    vod_id: r.vod_id,
                    sourceCode: r.source_code,
                    showIdentifier: r.show_identifier,
                    timestamp: r.timestamp,
                    playbackPosition: r.playback_position,
                    duration: r.duration,
                    episodes: JSON.parse(r.episodes || '[]'),
                }));
                return Response.json({ success: true, history }, { headers: corsHeaders });
            }

            case 'sync': {
                const { history } = await request.json();
                if (!Array.isArray(history)) {
                    return Response.json({ success: false, error: 'Invalid data' }, { status: 400, headers: corsHeaders });
                }

                const stmt = db.prepare(`
                    INSERT INTO watch_history 
                    (show_identifier, title, source_name, vod_id, source_code,
                     episode_index, direct_video_url, url, playback_position, 
                     duration, episodes, timestamp, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, unixepoch())
                    ON CONFLICT(show_identifier) DO UPDATE SET
                        title = excluded.title,
                        source_name = excluded.source_name,
                        vod_id = excluded.vod_id,
                        source_code = excluded.source_code,
                        episode_index = excluded.episode_index,
                        direct_video_url = excluded.direct_video_url,
                        url = excluded.url,
                        playback_position = excluded.playback_position,
                        duration = excluded.duration,
                        episodes = excluded.episodes,
                        timestamp = excluded.timestamp,
                        updated_at = unixepoch()
                `);

                const batch = history.map(h => stmt.bind(
                    h.showIdentifier || `${h.sourceName}_${h.vod_id}`,
                    h.title || '',
                    h.sourceName || '',
                    h.vod_id || '',
                    h.sourceCode || '',
                    h.episodeIndex || 0,
                    h.directVideoUrl || '',
                    h.url || '',
                    h.playbackPosition || 0,
                    h.duration || 0,
                    JSON.stringify(h.episodes || []),
                    h.timestamp || Date.now()
                ));

                await db.batch(batch);

                // Trim to 50 records
                await db.prepare(`
                    DELETE FROM watch_history WHERE show_identifier NOT IN (
                        SELECT show_identifier FROM watch_history ORDER BY timestamp DESC LIMIT 50
                    )
                `).run();

                return Response.json({ success: true }, { headers: corsHeaders });
            }

            case 'progress': {
                const { showId, position, duration } = await request.json();
                if (!showId) {
                    return Response.json({ success: false, error: 'Missing showId' }, { status: 400, headers: corsHeaders });
                }

                await db.prepare(`
                    UPDATE watch_history 
                    SET playback_position = ?1, duration = ?2, updated_at = unixepoch()
                    WHERE show_identifier = ?3
                `).bind(position || 0, duration || 0, showId).run();

                return Response.json({ success: true }, { headers: corsHeaders });
            }

            case 'delete': {
                const { showId } = await request.json();
                if (!showId) {
                    return Response.json({ success: false, error: 'Missing showId' }, { status: 400, headers: corsHeaders });
                }

                await db.prepare(
                    'DELETE FROM watch_history WHERE show_identifier = ?1'
                ).bind(showId).run();

                return Response.json({ success: true }, { headers: corsHeaders });
            }

            case 'clear': {
                await db.prepare('DELETE FROM watch_history').run();
                return Response.json({ success: true }, { headers: corsHeaders });
            }

            default:
                return Response.json({ success: false, error: 'Unknown action' }, { status: 404, headers: corsHeaders });
        }
    } catch (e) {
        return Response.json({ success: false, error: e.message }, { status: 500, headers: corsHeaders });
    }
}
