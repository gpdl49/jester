import { beforeEach, expect, it } from "vitest";
import type { Viewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { describeWithDb, resetDb } from "@/test/helpers/db";
import { TEST_USER } from "@/test/helpers/http";
import { ADMIN_USER, userId } from "@/test/helpers/users";
import { defaultSettings, getSettings, updateSettings } from "./service";

describeWithDb("settings service", () => {
	beforeEach(async () => {
		await resetDb();
	});

	async function getAdminViewer(): Promise<Viewer> {
		const id = await userId(ADMIN_USER);
		return {
			...ADMIN_USER,
			id,
			isAdmin: true,
		};
	}

	async function getNonAdminViewer(): Promise<Viewer> {
		const id = await userId(TEST_USER);
		return {
			...TEST_USER,
			id,
			isAdmin: false,
		};
	}

	it("returns default settings initially", async () => {
		const settings = await getSettings();
		expect(settings).toEqual(defaultSettings());
	});

	it("rejects non-admin actor with 403 forbidden", async () => {
		const viewer = await getNonAdminViewer();
		await expect(
			updateSettings({ "prefilter.threshold": 0.5 }, viewer),
		).rejects.toThrow(/Requires the jester-admin group/);
	});

	it("rejects unknown setting keys", async () => {
		const admin = await getAdminViewer();
		await expect(
			updateSettings(
				// @ts-expect-error testing invalid key
				{ "invalid.key": "foo" },
				admin,
			),
		).rejects.toThrow(/Unknown setting/);
	});

	it("rejects out-of-range prefilter.threshold (< 0 or > 1)", async () => {
		const admin = await getAdminViewer();
		await expect(
			updateSettings({ "prefilter.threshold": 1.5 }, admin),
		).rejects.toThrow();

		await expect(
			updateSettings({ "prefilter.threshold": -0.1 }, admin),
		).rejects.toThrow();
	});

	it("rejects autoAcceptThreshold below 0.5", async () => {
		const admin = await getAdminViewer();
		await expect(
			updateSettings({ "triage.autoAcceptThreshold": 0.4 }, admin),
		).rejects.toThrow();
	});

	it("accepts null for autoAcceptThreshold", async () => {
		const admin = await getAdminViewer();
		const updated = await updateSettings(
			{ "triage.autoAcceptThreshold": null },
			admin,
		);
		expect(updated["triage.autoAcceptThreshold"]).toBeNull();
	});

	it("rejects caption.template if {caption} placeholder is missing", async () => {
		const admin = await getAdminViewer();
		await expect(
			updateSettings({ "caption.template": "Just text without tag" }, admin),
		).rejects.toThrow(/must contain \{caption\}/);
	});

	it("updates settings and audits the change with old and new values", async () => {
		const admin = await getAdminViewer();
		const updated = await updateSettings(
			{
				"prefilter.threshold": 0.45,
				"caption.template": "{caption} | {credit}",
				"immich.deletePaused": true,
			},
			admin,
		);

		expect(updated["prefilter.threshold"]).toBe(0.45);
		expect(updated["caption.template"]).toBe("{caption} | {credit}");
		expect(updated["immich.deletePaused"]).toBe(true);

		const auditEvents = await db().auditEvent.findMany({
			where: { action: "settings.update" },
		});
		expect(auditEvents).toHaveLength(1);
		const event = auditEvents[0];
		if (!event) throw new Error("Expected event");
		expect(event.actorId).toBe(admin.id);
		expect(event.subjectType).toBe("setting");

		const changes = (
			event.data as {
				changes: Record<string, { from: unknown; to: unknown }>;
			}
		).changes;
		expect(changes["prefilter.threshold"]).toEqual({
			from: 0.35,
			to: 0.45,
		});
		expect(changes["immich.deletePaused"]).toEqual({
			from: false,
			to: true,
		});
	});
});
