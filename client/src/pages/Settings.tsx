import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError, type Member } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { Card, CardHead, ErrorBanner, Loading, Modal, PageHead } from "../components/ui.tsx";
import type { Category } from "@shared/types.ts";

export function Settings() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [reassigning, setReassigning] = useState<Category | null>(null);
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.categories(), api.members()])
      .then(([loadedCategories, loadedMembers]) => {
        setCategories(loadedCategories);
        setMembers(loadedMembers);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load settings"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setError(null);
    try {
      await api.createCategory(name);
      setNewCategory("");
      load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not add that category");
    }
  }

  async function deleteCategory(category: Category) {
    setError(null);
    // Categories still in use need a destination for their items first.
    if (category.itemCount > 0) {
      setReassigning(category);
      return;
    }
    if (!window.confirm(`Delete the "${category.name}" category?`)) return;
    try {
      await api.deleteCategory(category.id);
      load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not delete that category");
    }
  }

  async function move(category: Category, direction: -1 | 1) {
    const index = categories.findIndex((entry) => entry.id === category.id);
    const swapWith = categories[index + direction];
    if (!swapWith) return;
    try {
      await Promise.all([
        api.updateCategory(category.id, { sortOrder: swapWith.sortOrder }),
        api.updateCategory(swapWith.id, { sortOrder: category.sortOrder }),
      ]);
      load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not reorder");
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <PageHead title="Settings" subtitle={`Household: ${user?.householdName ?? ""}`} />

      <ErrorBanner error={error} />

      <Card>
        <CardHead title="Categories">
          <span className="small faint">used for grouping spend</span>
        </CardHead>

        <div className="card-body">
          <div className="form-row">
            <div>
              <label htmlFor="new-category">Add a category</label>
              <input
                id="new-category"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addCategory();
                  }
                }}
                placeholder="e.g. Baby Care"
              />
            </div>
            <div className="shrink">
              <button type="button" onClick={() => void addCategory()} disabled={newCategory.trim() === ""}>
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="card-body tight table-wrap">
          <table className="row-hover">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num-cell">Items</th>
                <th style={{ width: 220 }} />
              </tr>
            </thead>
            <tbody>
              {categories.map((category, index) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td className="num-cell">{category.itemCount}</td>
                  <td>
                    <div className="button-row">
                      <button
                        type="button"
                        className="ghost small"
                        disabled={index === 0}
                        onClick={() => void move(category, -1)}
                        aria-label={`Move ${category.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ghost small"
                        disabled={index === categories.length - 1}
                        onClick={() => void move(category, 1)}
                        aria-label={`Move ${category.name} down`}
                      >
                        ↓
                      </button>
                      <button type="button" className="ghost small" onClick={() => setRenaming(category)}>
                        Rename
                      </button>
                      <button type="button" className="danger small" onClick={() => void deleteCategory(category)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHead title="Household members">
          <button type="button" className="small" onClick={() => setInviting(true)}>
            Add member
          </button>
        </CardHead>
        <div className="card-body tight table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    {member.name}
                    {member.id === user?.id && <span className="pill accent" style={{ marginLeft: 8 }}>you</span>}
                  </td>
                  <td className="small muted">{member.email}</td>
                  <td className="small faint mono">{member.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p className="small faint" style={{ margin: 0 }}>
            Everyone in the household sees and edits the same items, bills and reports.
          </p>
        </div>
      </Card>

      {renaming && (
        <RenameDialog
          category={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            load();
          }}
        />
      )}

      {reassigning && (
        <ReassignDialog
          category={reassigning}
          categories={categories}
          onClose={() => setReassigning(null)}
          onSaved={() => {
            setReassigning(null);
            load();
          }}
        />
      )}

      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false);
            load();
          }}
        />
      )}
    </>
  );
}

function RenameDialog({
  category,
  onClose,
  onSaved,
}: {
  category: Category;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await api.updateCategory(category.id, { name: name.trim() });
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not rename");
    }
  }

  return (
    <Modal title="Rename category" onClose={onClose}>
      <ErrorBanner error={error} />
      <div className="field">
        <label htmlFor="rename">Name</label>
        <input id="rename" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </div>
      <div className="button-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={name.trim() === ""} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Modal>
  );
}

/** Deleting a category in use requires choosing where its items go. */
function ReassignDialog({
  category,
  categories,
  onClose,
  onSaved,
}: {
  category: Category;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const options = categories.filter((entry) => entry.id !== category.id);
  const [target, setTarget] = useState(options[0] ? String(options[0].id) : "");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    try {
      await api.deleteCategory(category.id, Number(target));
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not delete");
    }
  }

  return (
    <Modal title={`Delete "${category.name}"`} onClose={onClose}>
      <ErrorBanner error={error} />
      <p className="small muted" style={{ marginTop: 0 }}>
        {category.itemCount} item{category.itemCount === 1 ? "" : "s"} still use this category. Pick where they
        should go.
      </p>
      <div className="field">
        <label htmlFor="reassign">Move items to</label>
        <select id="reassign" value={target} onChange={(event) => setTarget(event.target.value)}>
          {options.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="button-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={target === ""} onClick={() => void confirm()}>
          Move and delete
        </button>
      </div>
    </Modal>
  );
}

function InviteDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.invite({ name: name.trim(), email: email.trim(), password });
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not add that member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add household member" onClose={onClose}>
      <ErrorBanner error={error} />
      <div className="field">
        <label htmlFor="member-name">Name</label>
        <input id="member-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </div>
      <div className="field">
        <label htmlFor="member-email">Email</label>
        <input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="member-password">Starting password</label>
        <input
          id="member-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="small faint" style={{ marginTop: 4 }}>
          At least 8 characters. Share it with them directly — they can sign in with it right away.
        </div>
      </div>
      <div className="button-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || name.trim() === "" || email.trim() === "" || password.length < 8}
          onClick={() => void save()}
        >
          {busy ? "Adding…" : "Add member"}
        </button>
      </div>
    </Modal>
  );
}
