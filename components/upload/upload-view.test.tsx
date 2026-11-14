// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UploadView } from "./upload-view";

describe("UploadView component", () => {
	it("renders the dropzone", () => {
		render(<UploadView />);
		expect(
			screen.getByText("Click to upload or drag and drop"),
		).toBeInTheDocument();
		expect(
			screen.getByText("JPEG, PNG, WebP or GIF up to 25 MiB each"),
		).toBeInTheDocument();
	});

	it("shows queued files when files are selected", () => {
		render(<UploadView />);
		const file = new File(["dummy content"], "funny-cat.jpg", {
			type: "image/jpeg",
		});
		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;

		fireEvent.change(input, { target: { files: [file] } });

		expect(screen.getByText("funny-cat.jpg")).toBeInTheDocument();
		expect(screen.getByText("1 file")).toBeInTheDocument();
	});

	it("immediately marks unsupported files as error", () => {
		render(<UploadView />);
		const badFile = new File(["dummy"], "contract.pdf", {
			type: "application/pdf",
		});
		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;

		fireEvent.change(input, { target: { files: [badFile] } });

		expect(screen.getByText("contract.pdf")).toBeInTheDocument();
		expect(
			screen.getByText("Unsupported format. Must be JPEG, PNG, WebP or GIF."),
		).toBeInTheDocument();
	});

	it("allows removing items from the upload list", () => {
		render(<UploadView />);
		const file = new File(["dummy"], "bad.pdf", {
			type: "application/pdf",
		});
		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement;

		fireEvent.change(input, { target: { files: [file] } });
		expect(screen.getByText("bad.pdf")).toBeInTheDocument();

		const removeBtn = screen.getByRole("button", { name: "Remove" });
		fireEvent.click(removeBtn);

		expect(screen.queryByText("bad.pdf")).not.toBeInTheDocument();
	});
});
