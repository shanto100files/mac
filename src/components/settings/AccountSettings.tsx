import React from "react";
import { FocusableButton } from "../layout/FocusableButton";
import { CustomSelect } from "../CustomSelect";
import { toast } from "../../lib/zustand/toastStore";
import {
  ACCOUNT_CHANGE_EVENT,
  getProfileId,
  getSession,
  setProfileId,
  type AccountSession,
  type SiteProfile,
} from "../../lib/site/accountStore";
import { fetchProfiles, login, logout } from "../../lib/site/siteApi";
import { resetLibrarySync, syncLibrary } from "../../lib/site/librarySync";

const profileOptions = (profiles: SiteProfile[]) => [
  { value: "0", label: "Account (no profile)" },
  ...profiles.map(profile => ({
    value: String(profile.id),
    label: profile.adult ? `${profile.name} (18+)` : profile.name,
  })),
];

export const AccountSettings: React.FC = () => {
  const [session, setSession] = React.useState<AccountSession | null>(() => getSession());
  const [identity, setIdentity] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [profiles, setProfiles] = React.useState<SiteProfile[]>([]);
  const [profileId, setProfile] = React.useState(() => getProfileId());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const refresh = () => setSession(getSession());
    window.addEventListener(ACCOUNT_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_CHANGE_EVENT, refresh);
  }, []);

  React.useEffect(() => {
    if (!session) {
      setProfiles([]);
      return;
    }
    fetchProfiles()
      .then(res => setProfiles(res.profiles || []))
      .catch(error => console.warn("Could not load profiles:", error));
  }, [session]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = () =>
    run(async () => {
      const account = await login(identity.trim(), password);
      setIdentity("");
      setPassword("");
      resetLibrarySync();
      await syncLibrary().catch(error =>
        console.warn("Library sync after sign-in failed:", error),
      );
      toast(`Signed in as ${account.username}`);
    });

  const handleLogout = () =>
    run(async () => {
      await logout();
      resetLibrarySync();
      setProfile(0);
      toast("Signed out. Your library stays on this device.");
    });

  const handleSync = () =>
    run(async () => {
      await syncLibrary();
      toast("Library synced");
    });

  const handleProfile = (value: string) => {
    const id = Number(value) || 0;
    setProfile(id);
    setProfileId(id);
    // Each profile has its own watchlist and 18+ setting on the account.
    resetLibrarySync();
    void syncLibrary().catch(error => console.warn("Profile switch sync failed:", error));
  };

  if (!session) {
    return (
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Cinepix Account</h3>
          <p className="body-md text-muted">
            Optional. Signing in syncs your watchlist and continue watching with
            your account, so the site and your other devices share one library.
            Everything keeps working signed out.
          </p>
          <div className="account-signin-fields">
            <input
              type="text"
              className="tmdb-key-input"
              placeholder="Username or email"
              value={identity}
              onChange={event => setIdentity(event.target.value)}
              aria-label="Username or email"
            />
            <input
              type="password"
              className="tmdb-key-input"
              placeholder="Password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") void handleLogin();
              }}
              aria-label="Password"
            />
            <div className="tmdb-key-actions">
              <FocusableButton
                className="theme-toggle-btn active"
                disabled={busy || !identity.trim() || !password}
                onClick={() => void handleLogin()}
              >
                {busy ? "Signing in..." : "Sign in"}
              </FocusableButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Signed in as {session.username}</h3>
          <p className="body-md text-muted">
            Watchlist and continue watching follow this account. Downloads and
            player settings stay on this device.
          </p>
        </div>
        <div className="tmdb-key-actions">
          <FocusableButton
            className="theme-toggle-btn active"
            disabled={busy}
            onClick={() => void handleSync()}
          >
            {busy ? "Syncing..." : "Sync now"}
          </FocusableButton>
          <FocusableButton
            className="theme-toggle-btn"
            disabled={busy}
            onClick={() => void handleLogout()}
          >
            Sign out
          </FocusableButton>
        </div>
      </div>
      {profiles.length > 0 && (
        <>
          <div className="settings-divider" />
          <div className="settings-row">
            <div className="settings-info">
              <h3 className="label-lg">Profile</h3>
              <p className="body-md text-muted">
                Picks which profile's library and 18+ setting this app uses.
              </p>
            </div>
            <CustomSelect
              value={String(profileId)}
              options={profileOptions(profiles)}
              onChange={handleProfile}
              className="account-profile-select"
            />
          </div>
        </>
      )}
    </>
  );
};
