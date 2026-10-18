import { beforeEach, describe, expect, it } from "vitest";
import { authService, DEMO_ADMIN, safeRedirect } from "@/lib/auth";
import { addAdmin, addUser, updateUser, resetStore } from "@/lib/store";
import { users } from "@/lib/data";

beforeEach(() => {
  window.localStorage.clear();
  resetStore();
});

describe("mock auth", () => {
  it("rejects bad credentials and signs in/out the demo admin", async () => {
    await expect(authService.signIn(DEMO_ADMIN.email, "nope")).rejects.toThrow();
    expect(authService.getSession()).toBeNull();
    const s = await authService.signIn(DEMO_ADMIN.email, DEMO_ADMIN.password);
    expect(s.role).toBe("Admin");
    expect(authService.getSession()?.email).toBe(DEMO_ADMIN.email);
    await authService.signOut();
    expect(authService.getSession()).toBeNull();
  });
  it("rejects disabled admins", async () => {
    await expect(authService.signIn("paolo@kilowhat.ph", DEMO_ADMIN.password)).rejects.toThrow(/disabled/);
  });
  it("only allows safe relative redirects", () => {
    expect(safeRedirect("/settings")).toBe("/settings");
    expect(safeRedirect("//evil.com")).toBeUndefined();
    expect(safeRedirect("https://evil.com")).toBeUndefined();
    expect(safeRedirect("/login")).toBeUndefined();
  });
});

describe("admin management", () => {
  it("adds a valid admin and rejects duplicates and bad input", () => {
    const ok = addAdmin({ name: "New Admin", email: "NEW@kilowhat.ph" });
    expect(ok).toMatchObject({ ok: true, data: { role: "Admin" } });
    expect(addAdmin({ name: "Dup", email: "new@kilowhat.ph" })).toMatchObject({ ok: false });
    expect(addAdmin({ name: "", email: "bad" })).toMatchObject({ ok: false, errors: { name: expect.any(String), email: expect.any(String) } });
  });
});

describe("add user", () => {
  it("adds an active user with the next id and rejects bad or duplicate input", () => {
    const input = { name: "New Tenant", email: "NEW.T@email.com", phone: "+63 917 111 2222", role: "Tenant", property: "Unit 1" };
    expect(addUser(input)).toMatchObject({ ok: true, data: { id: "USR-10249", status: "Active", email: "new.t@email.com" } });
    expect(addUser(input)).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
    expect(addUser({ name: "", email: "x", phone: "a", role: "Boss", property: "" })).toMatchObject({ ok: false });
  });
});

describe("edit user", () => {
  it("updates a user and validates input", () => {
    const id = users[0]!.id;
    const ok = updateUser(id, { name: "Maria S.", email: "maria@email.com", phone: "+63 917 000 1111", role: "Tenant", property: "Unit 9" });
    expect(ok).toMatchObject({ ok: true, data: { name: "Maria S.", role: "Tenant" } });
    expect(updateUser(id, { name: "A", email: "x", phone: "abc", role: "Boss", property: "" })).toMatchObject({ ok: false });
    expect(updateUser(id, { name: "Maria", email: users[1]!.email, phone: "+63 917 000 1111", role: "Tenant", property: "Unit 9" })).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
  });
});
