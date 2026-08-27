import { Router } from 'express';
import { isMockMode } from '../lib/config';
import { asUserId, asUsername } from '../lib/validate';
import { lookupProfile, mockProfile } from '../services/accountEvaluation';
import { BADGE_ICON_URLS, BADGE_NAMES, getAccountBadges } from '../services/robloxBadgesService';
import { getAvatarHeadshot, getAvatarHeadshots } from '../services/robloxThumbnailsService';
import { getUserIdByUsername } from '../services/robloxUsersService';

export const usersRouter = Router();

/**
 * Static metadata must be registered before the dynamic /:id/* routes,
 * otherwise Express would try to parse "meta" as a user ID.
 */
usersRouter.get('/meta/badges', (_req, res) => {
  res.json({ ok: true, badges: BADGE_NAMES, iconMap: BADGE_ICON_URLS });
});

/** POST /api/users/avatars — batch headshots for a result table. */
usersRouter.post('/avatars', async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    const ids = raw
      .slice(0, 100)
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ ok: false, error: 'userIds is required' });
    const map = await getAvatarHeadshots(ids);
    res.json({ ok: true, avatars: map });
  } catch (err) {
    next(err);
  }
});

/** GET /api/users/id/:id — full profile addressed by numeric ID. */
usersRouter.get('/id/:id', async (req, res, next) => {
  try {
    const id = asUserId(req.params.id);
    if (isMockMode()) return res.json({ ok: true, profile: mockProfile(id) });
    const { profile, error } = await lookupProfile(String(id), 'Yes');
    if (!profile) return res.status(404).json({ ok: false, error: error ?? 'User not found' });
    res.json({ ok: true, profile });
  } catch (err) {
    next(err);
  }
});

/** GET /api/users/:username — resolve by name and assemble a full profile. */
usersRouter.get('/:username', async (req, res, next) => {
  try {
    const username = asUsername(req.params.username);
    if (isMockMode()) return res.json({ ok: true, profile: mockProfile(1) });
    const { profile, error } = await lookupProfile(username, 'Yes');
    if (!profile) return res.status(404).json({ ok: false, error: error ?? 'User not found' });
    res.json({ ok: true, profile });
  } catch (err) {
    next(err);
  }
});

/** GET /api/users/resolve/:username — username -> id only (cheap). */
usersRouter.get('/resolve/:username', async (req, res, next) => {
  try {
    const username = asUsername(req.params.username);
    const id = await getUserIdByUsername(username);
    if (!id) return res.status(404).json({ ok: false, error: `No user found with name '${username}'` });
    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

/** GET /api/users/:id/avatar — headshot URL. */
usersRouter.get('/:id/avatar', async (req, res, next) => {
  try {
    const id = asUserId(req.params.id);
    const url = await getAvatarHeadshot(id);
    if (!url) return res.status(404).json({ ok: false, error: 'Thumbnail unavailable' });
    res.json({ ok: true, imageUrl: url });
  } catch (err) {
    next(err);
  }
});

/** GET /api/users/:id/badges — account badges with resolved icons. */
usersRouter.get('/:id/badges', async (req, res, next) => {
  try {
    const id = asUserId(req.params.id);
    const badges = await getAccountBadges(id);
    res.json({ ok: true, badges });
  } catch (err) {
    next(err);
  }
});
