import type { UserProfile, YesNo } from '../../shared/types';
import { profileCache } from '../lib/cache';
import { config } from '../lib/config';
import { log } from '../lib/logger';
import { getAccountBadges } from './robloxBadgesService';
import { getFullCollectibles, getHatCount, ownsVerifiedBadgeAsset } from './robloxInventoryService';
import { getAvatarHeadshot } from './robloxThumbnailsService';
import { getRigType, getUserIdByUsername, getUserById } from './robloxUsersService';

export interface ActivitySignals {
  rigType: 'R6' | 'R15' | null;
  /** Same underlying probe as `verified` in the desktop tool. */
  hasPlaidHat: boolean | null;
  hasDistinctDisplayName: boolean;
  oldPublicInventorySignal: boolean;
}

export interface ActivityVerdict {
  active: YesNo;
  reasons: string[];
}

/**
 * Faithful port of the desktop tool's activity heuristic.
 *
 * `defaultWhenUndecided` exists because the original behaved differently in the
 * two places it evaluated activity:
 *   - GenerateWorker (scan):  no decisive signals -> "No"
 *   - LookupWorker (lookup):  no decisive signals -> "Yes"
 * That divergence is preserved rather than "fixed", and is surfaced in the UI
 * copy so the number is never mistaken for ground truth.
 */
export function evaluateActivity(
  signals: ActivitySignals,
  defaultWhenUndecided: YesNo,
): ActivityVerdict {
  const { rigType, hasPlaidHat, hasDistinctDisplayName, oldPublicInventorySignal } = signals;
  const reasons: string[] = [];
  let active: YesNo | null = null;

  if (hasPlaidHat === true) {
    active = 'Yes';
    reasons.push('has_plaid_hat=True');
  }
  if (hasDistinctDisplayName) {
    active = 'Yes';
    reasons.push('has_distinct_display_name=True');
  }
  if (oldPublicInventorySignal) {
    active = 'Yes';
    reasons.push('old_public_inventory_signal=True (<=2014, inventory private now)');
  }
  if (rigType === 'R6') {
    active = 'Yes';
    reasons.push('is_r15=False (R6)');
  }

  if (active === null) {
    if (hasPlaidHat === false) reasons.push('has_plaid_hat=False (no plaid-hat signal)');
    if (rigType === 'R15') {
      active = 'No';
      reasons.push('is_r15=True (R15) and no positive signals');
    }
  }

  if (active === null) {
    active = defaultWhenUndecided;
    reasons.push(`no decisive signals -> default ${defaultWhenUndecided === 'Yes' ? 'active' : 'unactive'}`);
  }

  return { active, reasons };
}

export function parseCreatedDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function parseCreatedYear(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

export interface AssembleOptions {
  /** Which default to use when the heuristic is undecided. */
  defaultActive: YesNo;
  /** Skip the expensive collectible walk (used by the scanner's fast path). */
  signal?: AbortSignal;
  tag: 'lookup' | 'scan';
}

/**
 * Builds a full UserProfile from the public Roblox APIs.
 *
 * Sub-requests run concurrently but each failure is contained: anything we
 * cannot read is reported as Unknown / degraded, never guessed.
 */
export async function assembleProfile(userId: number, opts: AssembleOptions): Promise<UserProfile | null> {
  const { signal, tag } = opts;

  // Assembled profiles are expensive (a full RAP walk among other calls) but
  // change slowly — repeat lookups within the TTL answer from memory.
  const profileKey = `fullprofile:${userId}:${opts.defaultActive}`;
  const cachedProfile = profileCache.get<UserProfile>(profileKey);
  if (cachedProfile) return cachedProfile;

  const degraded: string[] = [];

  const { user, error } = await getUserById(userId, signal);
  if (!user) {
    log(tag === 'lookup' ? 'lookup' : 'worker', `User lookup failed for id ${userId}`, {
      userId,
      status: error?.status ?? null,
      detail: error?.message,
      jobId: undefined,
    });
    return null;
  }

  const username = user.name || '';
  const displayName = user.displayName || '';
  const createdYear = parseCreatedYear(user.created);
  const hasDistinctDisplayName = Boolean(displayName.trim()) && displayName !== username;

  const [rigType, plaidHat, collectibles, hats, badges, avatarUrl] = await Promise.all([
    getRigType(userId, signal),
    ownsVerifiedBadgeAsset(userId, signal),
    getFullCollectibles(userId, signal),
    getHatCount(userId, signal),
    getAccountBadges(userId, signal),
    getAvatarHeadshot(userId, signal),
  ]);

  if (rigType === null) degraded.push('rig');
  if (plaidHat === null) degraded.push('verification');
  if (collectibles.status !== 'ok') degraded.push('inventory');
  if (hats === null) degraded.push('hats');
  if (!avatarUrl) degraded.push('avatar');

  const oldPublicInventorySignal =
    createdYear !== null && createdYear <= 2014 && collectibles.status !== 'ok' && collectibles.items.length === 0;

  const verdict = evaluateActivity(
    { rigType, hasPlaidHat: plaidHat, hasDistinctDisplayName, oldPublicInventorySignal },
    opts.defaultActive,
  );

  log(
    tag === 'lookup' ? 'lookup' : 'worker',
    `active-eval uid=${userId} is_r15=${rigType === 'R15'} rig=${rigType ?? 'unknown'}, ` +
      `has_plaid_hat=${plaidHat}, username='${username}', display_name='${displayName}', ` +
      `has_distinct_display_name=${hasDistinctDisplayName}, year=${createdYear}, ` +
      `old_public_inventory_signal=${oldPublicInventorySignal} -> active=${verdict.active} (${verdict.reasons.join(', ')})`,
    { userId },
  );

  const profile: UserProfile = {
    id: user.id,
    username,
    displayName,
    created: user.created,
    createdDate: parseCreatedDate(user.created),
    createdYear,
    description: user.description,
    banned: user.isBanned ? 'Yes' : 'No',
    verified: plaidHat === true ? 'Yes' : 'No',
    active: verdict.active,
    activeReasons: verdict.reasons,
    rap: collectibles.rap,
    rapValue: collectibles.rapValue,
    hats: hats === null ? 'Unknown' : String(hats),
    hatCount: hats,
    rigType,
    avatarUrl,
    badges,
    inventoryStatus: collectibles.status,
    profileUrl: `https://www.roblox.com/users/${user.id}/profile`,
    fetchedAt: Date.now(),
    degraded,
  };
  if (!signal?.aborted) profileCache.set(profileKey, profile, config.profileCacheTtlMs);
  return profile;
}

/** Resolve either a username or a numeric ID, then assemble the profile. */
export async function lookupProfile(
  query: string,
  defaultActive: YesNo,
  signal?: AbortSignal,
): Promise<{ profile: UserProfile | null; error: string | null }> {
  const trimmed = query.trim();
  let userId: number | null = null;

  if (/^\d+$/.test(trimmed)) {
    userId = Number.parseInt(trimmed, 10);
  } else {
    try {
      userId = await getUserIdByUsername(trimmed, signal);
    } catch (err) {
      log('lookup', `Username resolution failed for '${trimmed}'`, { detail: (err as Error).message });
      return { profile: null, error: 'Connection failed' };
    }
  }

  if (!userId) {
    log('lookup', `No user found with name '${trimmed}'`);
    return { profile: null, error: `No user found with name '${trimmed}'` };
  }

  log('lookup', `Lookup for '${trimmed}' resolved to id ${userId}`, { userId });
  const profile = await assembleProfile(userId, { defaultActive, signal, tag: 'lookup' });
  if (!profile) return { profile: null, error: 'Failed to fetch user details.' };

  log(
    'lookup',
    `Lookup OK ${profile.id} ${profile.username} created=${profile.createdDate} RAP=${profile.rap} ` +
      `badges=${profile.badges.length} verified=${profile.verified} banned=${profile.banned} ` +
      `active=${profile.active} hats=${profile.hats}`,
    { userId: profile.id },
  );

  return { profile, error: null };
}

export const mockProfile = (seed = 1): UserProfile => ({
  id: seed,
  username: `MockUser${seed}`,
  displayName: `Mock User ${seed}`,
  created: '2010-01-01T00:00:00.000Z',
  createdDate: '2010-01-01',
  createdYear: 2010,
  description: 'Generated by VESPER_MOCK_MODE.',
  banned: 'No',
  verified: 'No',
  active: 'No',
  activeReasons: ['mock mode'],
  rap: '0',
  rapValue: 0,
  hats: '0',
  hatCount: 0,
  rigType: 'R15',
  avatarUrl: null,
  badges: [],
  inventoryStatus: 'unavailable',
  profileUrl: `https://www.roblox.com/users/${seed}/profile`,
  fetchedAt: Date.now(),
  degraded: ['mock'],
});

export function mockEnabled(): boolean {
  return config.mockMode;
}
