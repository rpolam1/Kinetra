import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { AuthUser, Role, SignUpInput } from '../../domain';
import { validateSignUp } from '../../domain';
import { DataError } from '../repositories';
import type { AuthService } from '../repositories';
import { newProfile, readAccount, toAuthUser } from './accountMapping';
import { mapFirebaseError } from './errors';

/** What the app sees for someone who is signed in but has no readable profile. They have no role, so they can do nothing. */
function signedInWithoutProfile(user: User): AuthUser {
  return { uid: user.uid, email: user.email ?? '', displayName: user.displayName ?? '', role: null, status: 'pending', requestedRole: null };
}

/** Signs in with Firebase and reads the person's role from their profile document in the users collection. */
export class FirebaseAuthService implements AuthService {
  readonly demo = false;
  private user: AuthUser | null = null;
  // Set while a profile is being written, so the listener does not write a second one
  private creatingProfile = false;
  private stopWatchingProfile: (() => void) | null = null;

  constructor(
    private readonly auth: Auth,
    private readonly db: Firestore,
  ) {}

  current(): AuthUser | null {
    return this.user;
  }

  /** Sign in. The role arrives through subscribe, so it may not be set yet when this returns. */
  async signIn(email: string, password: string): Promise<AuthUser> {
    try {
      await signInWithEmailAndPassword(this.auth, email.trim(), password);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')) {
        throw new DataError('permission', 'Wrong email or password');
      }
      if (code.includes('too-many-requests')) {
        throw new DataError('unavailable', 'Too many attempts. Wait a few minutes and try again.');
      }
      throw mapFirebaseError(error);
    }
    // the role comes through subscribe()
    return this.user ?? signedInWithoutProfile(this.auth.currentUser as User);
  }

  /** Create the account and a pending profile. The person has no access until an admin approves them. */
  async signUp(input: SignUpInput): Promise<AuthUser> {
    const errors = validateSignUp(input);
    const first = Object.values(errors)[0];
    if (first) throw new DataError('invalid', first);
    const email = input.email.trim();
    const displayName = input.displayName.trim();
    this.creatingProfile = true;
    try {
      const credential = await createUserWithEmailAndPassword(this.auth, email, input.password);
      await updateProfile(credential.user, { displayName }).catch(() => undefined);
      const profile = newProfile(credential.user.uid, email.toLowerCase(), displayName, input.requestedRole, Date.now());
      await setDoc(doc(this.db, 'users', credential.user.uid), profile);
      this.user = toAuthUser(readAccount(credential.user.uid, profile));
      return this.user;
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code.includes('email-already-in-use')) throw new DataError('conflict', 'An account with this email already exists. Try signing in.');
      if (code.includes('weak-password')) throw new DataError('invalid', 'Choose a stronger password (at least 8 characters).');
      if (code.includes('invalid-email')) throw new DataError('invalid', 'Enter a valid email address');
      throw mapFirebaseError(error);
    } finally {
      this.creatingProfile = false;
    }
  }

  /** Ask for a higher role. An admin has to approve it. */
  async requestRole(role: Role): Promise<void> {
    const me = this.auth.currentUser;
    if (!me) throw new DataError('permission', 'Sign in first');
    try {
      await updateDoc(doc(this.db, 'users', me.uid), { requestedRole: role, awaiting: true });
    } catch (error) {
      throw mapFirebaseError(error);
    }
  }

  async signOut(): Promise<void> {
    this.stopWatchingProfile?.();
    this.stopWatchingProfile = null;
    await signOut(this.auth);
    this.user = null;
  }

  /** Call the listener whenever the signed in person or their profile changes. Returns a function that stops listening. */
  subscribe(listener: (user: AuthUser | null) => void): () => void {
    const stopAuth = onAuthStateChanged(this.auth, (fbUser) => {
      this.stopWatchingProfile?.();
      this.stopWatchingProfile = null;
      if (!fbUser) {
        this.user = null;
        listener(null);
        return;
      }
      this.stopWatchingProfile = onSnapshot(
        doc(this.db, 'users', fbUser.uid),
        (snap) => {
          if (!snap.exists()) {
            // made in the console, so no profile yet: file a request for them
            if (!this.creatingProfile) void this.createMissingProfile(fbUser);
            this.user = signedInWithoutProfile(fbUser);
          } else {
            this.user = toAuthUser(readAccount(fbUser.uid, snap.data()));
          }
          listener(this.user);
        },
        () => {
          // can't read the profile, so treat it as no access
          this.user = signedInWithoutProfile(fbUser);
          listener(this.user);
        },
      );
    });
    return () => {
      stopAuth();
      this.stopWatchingProfile?.();
      this.stopWatchingProfile = null;
    };
  }

  /** File a volunteer request for an account that was made outside the app, such as in the Firebase console. A failure is ignored because the next sign in tries again. */
  private async createMissingProfile(fbUser: User): Promise<void> {
    this.creatingProfile = true;
    try {
      const email = (fbUser.email ?? '').toLowerCase();
      await setDoc(doc(this.db, 'users', fbUser.uid), newProfile(fbUser.uid, email, fbUser.displayName ?? email, 'volunteer', Date.now()));
    } catch {
    } finally {
      this.creatingProfile = false;
    }
  }
}
