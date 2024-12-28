import { Plugin, TFolder, TFile, Keymap } from "obsidian";

export default class CtrlClickSplitOpenPlugin extends Plugin {
	async onload() {
		console.log("Loading CtrlClickSplitOpenPlugin...");

		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			if (!Keymap.isModEvent(evt)) return; // Only respond to Ctrl/Cmd+click

			// Climb up the DOM to check if the clicked element is a folder in the explorer
			const target = evt.target as HTMLElement;
			const folderTitleEl = target?.closest(".nav-folder-title");
			if (!folderTitleEl) return;

			const folderPath = folderTitleEl.getAttribute("data-path");
			if (!folderPath) return;

			const maybeFolder = this.app.vault.getAbstractFileByPath(folderPath);
			if (maybeFolder instanceof TFolder) {
				// Prevent the default expand/collapse behavior
				evt.preventDefault();
				evt.stopPropagation();

				this.openAllFilesInSplits(maybeFolder);
			}
		});
	}

	/**
	 * Opens every file (including subfolders) in new, horizontally split panes.
	 */
	private openAllFilesInSplits(folder: TFolder) {
		const allFiles = this.getAllFilesRecursively(folder);

		if (allFiles.length === 0) return;

		// Open the first file in the active pane
		const activeLeaf = this.app.workspace.getMostRecentLeaf();
		if (activeLeaf) {
			activeLeaf.openFile(allFiles[0]);
		}

		// For the remaining files, create new split panes
		for (let i = 1; i < allFiles.length; i++) {
			const newLeaf = this.app.workspace.splitActiveLeaf("horizontal");
			newLeaf.openFile(allFiles[i]);
		}
	}

	/**
	 * Recursively collect all TFile objects in `folder`.
	 */
	private getAllFilesRecursively(folder: TFolder): TFile[] {
		let result: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				result.push(child);
			} else if (child instanceof TFolder) {
				result = result.concat(this.getAllFilesRecursively(child));
			}
		}
		return result;
	}

	onunload() {
		console.log("Unloading CtrlClickSplitOpenPlugin.");
	}
}
