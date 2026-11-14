// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaptionEditor } from "./caption-editor";

describe("CaptionEditor component", () => {
	it("renders caption input with live counters", () => {
		const onChange = vi.fn();
		render(
			<CaptionEditor
				caption="Hello world"
				onChange={onChange}
				items={[
					{
						meme: {
							creditText: "alice",
							hashtags: ["one", "two"],
						},
					},
				]}
			/>,
		);

		const input = screen.getByRole("textbox");
		expect(input).toBeInTheDocument();
		expect(input).toHaveValue("Hello world");

		const charCounter = screen.getByTestId("char-counter");
		expect(charCounter).toHaveTextContent(/2,200/);

		const tagCounter = screen.getByTestId("tag-counter");
		expect(tagCounter).toHaveTextContent("2 / 30 tags");

		// Trigger change
		fireEvent.change(input, { target: { value: "New caption" } });
		expect(onChange).toHaveBeenCalledWith("New caption");
	});

	it("displays character warning when caption exceeds 2,200 characters", () => {
		const longCaption = "X".repeat(2250);
		render(
			<CaptionEditor
				caption={longCaption}
				onChange={vi.fn()}
				items={[
					{
						meme: {
							creditText: "artist",
							hashtags: [],
						},
					},
				]}
			/>,
		);

		const charCounter = screen.getByTestId("char-counter");
		expect(charCounter.className).toContain("text-danger");

		const warningsList = screen.getByTestId("caption-warnings-list");
		expect(warningsList).toHaveTextContent("Caption exceeds 2,200 characters");
	});

	it("displays hashtag warning when tags exceed 30", () => {
		const tags = Array.from({ length: 35 }, (_, i) => `tag${i}`);
		render(
			<CaptionEditor
				caption="Testing tags"
				onChange={vi.fn()}
				items={[
					{
						meme: {
							creditText: "artist",
							hashtags: tags,
						},
					},
				]}
			/>,
		);

		const tagCounter = screen.getByTestId("tag-counter");
		expect(tagCounter).toHaveTextContent("35 / 30 tags");
		expect(tagCounter.className).toContain("text-danger");

		const warningsList = screen.getByTestId("caption-warnings-list");
		expect(warningsList).toHaveTextContent("Hashtags trimmed to 30");
	});

	it("displays unknown creator and sensitive content warnings", () => {
		render(
			<CaptionEditor
				caption="Test post"
				onChange={vi.fn()}
				items={[
					{
						meme: {
							creditText: null, // unknown
							hashtags: [],
							sensitivity: { nsfw: true },
						},
					},
				]}
			/>,
		);

		const warningsList = screen.getByTestId("caption-warnings-list");
		expect(warningsList).toHaveTextContent("Unknown creator");
		expect(warningsList).toHaveTextContent("Post contains sensitive content");
	});
});
