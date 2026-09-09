import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { Card } from "../components/ui.tsx";

export function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      if (isSignup) await signup({ email, password, name, householdName });
      else await login(email, password);
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        setFields(caught.fields);
      } else {
        setError("Could not reach the server");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <div className="auth-card">
        <div className="auth-head">
          <h1>
            <span className="brand-mark" style={{ display: "inline-grid", verticalAlign: "-4px", marginRight: 8 }}>
              ₹
            </span>
            Grocery Tracker
          </h1>
          <p>{isSignup ? "Create a household to start logging bills." : "Sign in to your household."}</p>
        </div>

        <Card>
          <form className="card-body" onSubmit={submit} noValidate>
            {error && (
              <div className="banner error" role="alert" style={{ marginBottom: "1rem" }}>
                {error}
              </div>
            )}

            {isSignup && (
              <>
                <div className="field">
                  <label htmlFor="name">Your name</label>
                  <input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                  />
                  {fields["name"] && <div className="field-error">{fields["name"]}</div>}
                </div>
                <div className="field">
                  <label htmlFor="household">Household name</label>
                  <input
                    id="household"
                    value={householdName}
                    onChange={(event) => setHouseholdName(event.target.value)}
                    placeholder="e.g. Home"
                    required
                  />
                  {fields["householdName"] && <div className="field-error">{fields["householdName"]}</div>}
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
              />
              {fields["email"] && <div className="field-error">{fields["email"]}</div>}
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
              />
              {fields["password"] && <div className="field-error">{fields["password"]}</div>}
              {isSignup && !fields["password"] && <div className="small faint" style={{ marginTop: 4 }}>At least 8 characters.</div>}
            </div>

            <button type="submit" className="primary" disabled={busy} style={{ width: "100%", marginTop: "0.5rem" }}>
              {busy ? "Working…" : isSignup ? "Create household" : "Sign in"}
            </button>
          </form>
        </Card>

        <p className="small muted" style={{ textAlign: "center", marginTop: "1rem" }}>
          {isSignup ? "Already have an account? " : "New here? "}
          <button
            type="button"
            className="ghost small"
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError(null);
              setFields({});
            }}
          >
            {isSignup ? "Sign in" : "Create a household"}
          </button>
        </p>
      </div>
    </div>
  );
}
