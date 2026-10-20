import { query } from '../database/db';

const VALID_PLATFORMS = new Set(['android', 'ios']);
const VALID_EVENTS = new Set([
  'install_prompt_shown',
  'install_prompt_accepted',
  'install_prompt_declined',
  'install_guide_opened',
  'install_guide_dismissed',
  'app_installed',
]);

function sanitise(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

export class InstallAnalyticsService {
  static async recordEvent(params: {
    sessionId: string;
    visitorId?: string;
    platform: string;
    eventName: string;
  }): Promise<boolean> {
    const sessionId = sanitise(params.sessionId, 128);
    const visitorId = sanitise(params.visitorId, 128);
    if (!sessionId) return false;
    if (!VALID_PLATFORMS.has(params.platform)) return false;
    if (!VALID_EVENTS.has(params.eventName)) return false;

    const platform = params.platform;
    const eventName = params.eventName;

    await query(
      `INSERT INTO mart_install_events (session_id, visitor_id, platform, event_name)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, visitorId, platform, eventName]
    );

    const accepted = eventName === 'install_prompt_accepted' ? 1 : 0;
    const declined = eventName === 'install_prompt_declined' ? 1 : 0;
    const guideOpened = eventName === 'install_guide_opened' ? 1 : 0;
    const guideDismissed = eventName === 'install_guide_dismissed' ? 1 : 0;
    const appInstalled = eventName === 'app_installed' ? 1 : 0;

    await query(
      `INSERT INTO mart_install_rollup (
        visitor_id, platform, first_seen_at, last_seen_at,
        prompt_shown, prompt_accepted, prompt_declined,
        guide_opened, guide_dismissed, app_installed
      ) VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, $6, $7, $8)
      ON CONFLICT (visitor_id) DO UPDATE SET
        last_seen_at = NOW(),
        prompt_shown = mart_install_rollup.prompt_shown + $3,
        prompt_accepted = mart_install_rollup.prompt_accepted + $4,
        prompt_declined = mart_install_rollup.prompt_declined + $5,
        guide_opened = mart_install_rollup.guide_opened + $6,
        guide_dismissed = mart_install_rollup.guide_dismissed + $7,
        app_installed = mart_install_rollup.app_installed + $8`,
      [
        visitorId ?? sessionId,
        platform,
        eventName === 'install_prompt_shown' ? 1 : 0,
        accepted,
        declined,
        guideOpened,
        guideDismissed,
        appInstalled,
      ]
    );

    return true;
  }

  static async getSummary(from?: string, to?: string) {
    let where = '';
    let params: string[] = [];
    if (from && to) {
      where = 'WHERE created_at BETWEEN $1 AND $2';
      params = [from, to];
    } else if (from) {
      where = 'WHERE created_at >= $1';
      params = [from];
    } else if (to) {
      where = 'WHERE created_at <= $1';
      params = [to];
    }

    const [byPlatform, byEvent, totals, uniqueVisitors, shareClicks] = await Promise.all([
      query(
        `SELECT platform,
                COUNT(*) AS events,
                COUNT(DISTINCT session_id) AS sessions
         FROM mart_install_events ${where}
         GROUP BY platform`,
        params
      ),
      query(
        `SELECT event_name, platform, COUNT(*) AS count
         FROM mart_install_events ${where}
         GROUP BY event_name, platform
         ORDER BY event_name, platform`,
        params
      ),
      query(
        `SELECT COUNT(*) AS total_events,
                COUNT(DISTINCT session_id) AS total_sessions
         FROM mart_install_events ${where}`,
        params
      ),
      query(
        `SELECT platform, COUNT(DISTINCT COALESCE(visitor_id, session_id)) AS unique_visitors
         FROM mart_install_events ${where}
         GROUP BY platform`,
        params
      ),
      // Share App clicks live in the funnel events table (share_app_clicked),
      // not the install table, because sharing is a growth action anyone can
      // take, installed or not. Counted by the device platform the client sent.
      query(
        `SELECT platform, COUNT(*) AS count
         FROM mart_funnel_events
         WHERE event_name = 'share_app_clicked'
           AND ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
           AND ($2::timestamptz IS NULL OR created_at <= $2::timestamptz)
         GROUP BY platform`,
        [from ?? null, to ?? null]
      ),
    ]);

    return {
      byPlatform: byPlatform.rows,
      byEvent: byEvent.rows,
      totals: totals.rows[0] ?? { total_events: 0, total_sessions: 0 },
      uniqueVisitors: uniqueVisitors.rows,
      shareClicks: shareClicks.rows,
    };
  }
}

