import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryAccountRepository } from '../src/data/memory/MemoryAccountRepository';
import { MemoryAuthService } from '../src/data/memory/MemoryAuthService';
import { MemoryStore } from '../src/data/memory/MemoryStore';
import { DataError } from '../src/data/repositories';
import { awaitingKind, requestSummary, sortAccounts, upgradeOptions, validateSignUp } from '../src/domain/accounts';
import type { UserAccount } from '../src/domain';
import { MAX_PER_PAGE, densityFor, paginate, planGrid } from '../src/features/session/boardLayout';
import { timeAgo } from '../src/ui/format';

function account(extra: Partial<UserAccount>): UserAccount {
  return {
    uid: 'u',
    email: 'a@x.test',
    displayName: 'A',
    role: null,
    status: 'pending',
    requestedRole: 'volunteer',
    awaiting: true,
    createdAt: 0,
    decidedBy: null,
    decidedAt: null,
    ...extra,
  };
}

const valid = { displayName: 'Ana Kowalski', email: 'ana@clinic.test', password: 'longenough', requestedRole: 'instructor' as const };

describe('accounts: sign-up validation', () => {
  it('accepts a complete form', () => {
    assert.deepEqual(validateSignUp({ ...valid, confirmPassword: 'longenough' }), {});
  });
  it('reports each bad field by name', () => {
    const errors = validateSignUp({ displayName: 'A', email: 'nope', password: 'short', requestedRole: 'admin' });
    assert.deepEqual(Object.keys(errors).sort(), ['displayName', 'email', 'password', 'requestedRole']);
  });
  it('checks the confirmation only when given', () => {
    assert.ok(validateSignUp({ ...valid, confirmPassword: 'different1' }).confirmPassword);
  });
});

describe('accounts: requests', () => {
  it('only offers roles above the current one', () => {
    assert.deepEqual(upgradeOptions('volunteer'), ['instructor', 'admin']);
    assert.deepEqual(upgradeOptions('instructor'), ['admin']);
    assert.deepEqual(upgradeOptions('admin'), []);
    assert.deepEqual(upgradeOptions(null), []);
  });
  it('tells new requests from upgrades', () => {
    assert.equal(awaitingKind(account({})), 'new');
    assert.equal(awaitingKind(account({ status: 'approved', role: 'instructor', requestedRole: 'admin' })), 'upgrade');
    assert.equal(awaitingKind(account({ awaiting: false })), null);
    assert.match(requestSummary(account({ requestedRole: 'instructor' })), /join as instructor/);
    assert.match(requestSummary(account({ status: 'approved', role: 'instructor', requestedRole: 'admin' })), /instructor.*administrator/i);
  });
  it('lists waiting accounts first, oldest request first', () => {
    const list = sortAccounts([
      account({ uid: 'z', displayName: 'Zed', awaiting: false, status: 'approved' }),
      account({ uid: 'new', displayName: 'New', createdAt: 20 }),
      account({ uid: 'old', displayName: 'Old', createdAt: 10 }),
      account({ uid: 'b', displayName: 'Bea', awaiting: false, status: 'approved' }),
    ]);
    assert.deepEqual(list.map((a) => a.uid), ['old', 'new', 'b', 'z']);
  });
});

describe('accounts: sign-up and admin approval (demo backend)', () => {
  function setup() {
    const store = new MemoryStore();
    return { auth: new MemoryAuthService(store), accounts: new MemoryAccountRepository(store) };
  }

  it('a new person has no role and no access until approved', async () => {
    const { auth } = setup();
    const user = await auth.signUp(valid);
    assert.deepEqual([user.role, user.status, user.requestedRole], [null, 'pending', 'instructor']);
  });
  it('rejects duplicate emails and weak passwords', async () => {
    const { auth } = setup();
    await auth.signUp(valid);
    await assert.rejects(auth.signUp(valid), (e: unknown) => e instanceof DataError && e.code === 'conflict');
    await assert.rejects(auth.signUp({ ...valid, email: 'b@clinic.test', password: 'short' }), (e: unknown) => e instanceof DataError && e.code === 'invalid');
  });
  it('approval reaches the signed-in person without signing in again', async () => {
    const { auth, accounts } = setup();
    const seen: (string | null)[] = [];
    const me = await auth.signUp(valid);
    auth.subscribe((u) => seen.push(u?.status ?? null));
    await accounts.approve(me.uid, 'instructor', 'demo-admin');
    assert.deepEqual([auth.current()?.status, auth.current()?.role], ['approved', 'instructor']);
    assert.ok(seen.includes('approved'));
  });
  it('an instructor can ask for admin, and an admin grants it', async () => {
    const { auth, accounts } = setup();
    await auth.signIn('instructor@demo.test', 'demo');
    await auth.requestRole('admin');
    let list: UserAccount[] = [];
    accounts.watch((a) => (list = a), () => undefined)();
    const mine = list.find((a) => a.uid === 'demo-instructor');
    assert.equal(awaitingKind(mine!), 'upgrade');
    await accounts.setRole('demo-instructor', 'admin', 'demo-admin');
    assert.equal(auth.current()?.role, 'admin');
  });
  it('declines pending people, and admins cannot change themselves', async () => {
    const { auth, accounts } = setup();
    const me = await auth.signUp(valid);
    await accounts.reject(me.uid, 'demo-admin');
    assert.equal(auth.current()?.status, 'rejected');
    await assert.rejects(accounts.setRole('demo-admin', 'volunteer', 'demo-admin'), (e: unknown) => e instanceof DataError && e.code === 'permission');
    await assert.rejects(accounts.setStatus('demo-admin', 'disabled', 'demo-admin'), (e: unknown) => e instanceof DataError && e.code === 'permission');
  });
  it('switching an account off is seen at once', async () => {
    const { auth, accounts } = setup();
    await auth.signIn('volunteer@demo.test', 'demo');
    await accounts.setStatus('demo-volunteer', 'disabled', 'demo-admin');
    assert.equal(auth.current()?.status, 'disabled');
  });
});

describe('board layout', () => {
  const W = 1920;
  const H = 1000;
  for (const n of [1, 4, 15, 24, 30]) {
    it(`${n} people fit the screen`, () => {
      const plan = planGrid(n, W, H, 12);
      assert.ok(plan.cols * plan.rows >= n);
      assert.ok(plan.cols * plan.tileWidth + (plan.cols - 1) * 12 <= W + plan.cols);
      assert.ok(plan.rows * plan.tileHeight + (plan.rows - 1) * 12 <= H + plan.rows);
      assert.ok(plan.tileWidth > 0 && plan.tileHeight > 0);
    });
  }
  it('tiles stay readable at 30 people on a TV and on a small laptop', () => {
    assert.ok(planGrid(30, 1920, 1000, 12).tileHeight >= 120);
    assert.ok(planGrid(30, 1280, 640, 10).tileWidth >= 150);
  });
  it('gives fewer people bigger tiles', () => {
    assert.ok(planGrid(4, W, H, 12).tileWidth > planGrid(30, W, H, 12).tileWidth);
  });
  it('survives a zero-size container', () => {
    const plan = planGrid(5, 0, 0, 12);
    assert.ok(plan.cols >= 1 && plan.rows >= 1);
  });
  it('pages large rosters evenly and keeps everyone', () => {
    const people = Array.from({ length: 40 }, (_, i) => i);
    const pages = paginate(people);
    assert.deepEqual(pages.map((p) => p.length), [20, 20]);
    assert.deepEqual(pages.flat(), people);
    assert.equal(paginate(people.slice(0, MAX_PER_PAGE)).length, 1);
    assert.equal(paginate(people.slice(0, 31)).length, 2);
    assert.deepEqual(paginate([]), [[]]);
  });
  it('trims detail as the board fills', () => {
    assert.deepEqual([4, 10, 18, 30].map(densityFor), ['roomy', 'comfy', 'compact', 'dense']);
  });
});

describe('timeAgo', () => {
  const now = 10_000_000_000;
  it('reads naturally', () => {
    assert.equal(timeAgo(now - 10_000, now), 'just now');
    assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago');
    assert.equal(timeAgo(now - 3 * 3_600_000, now), '3 h ago');
    assert.equal(timeAgo(now - 2 * 86_400_000, now), '2 d ago');
  });
});
