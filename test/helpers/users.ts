import { ensureUserRow, type User } from "@/lib/auth";
import { TEST_USER } from "@/test/helpers/http";

/** A second signed-in user and an admin. */
export const OTHER_USER: User = {
	sub: "other-sub",
	email: "other@example.com",
	username: "other",
	groups: ["jester"],
};
export const ADMIN_USER: User = {
	sub: "admin-sub",
	email: "admin@example.com",
	username: "admin",
	groups: ["jester", "jester-admin"],
};

/** The user's id, creating the row as signing in would. */
export const userId = (user: User = TEST_USER): Promise<string> =>
	ensureUserRow(user);
