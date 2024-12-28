import { Plugin, TFile, TFolder, Keymap } from "obsidian";

export default class CtrlClickOpenAllPlugin extends Plugin {
	async onload() {
		console.log("Loading CtrlClickOpenAllPlugin...");

		// Listen for clicks anywhere in the DOM.
		// If it's a ctrl/cmd-click on a folder in the file explorer, open all files.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			// Check if user is holding Ctrl/Cmd (on Mac, Cmd is also recognized as "mod").
			if (!Keymap.isModEvent(evt)) return;

			// Attempt to find a folder element in the file explorer by climbing up the DOM.
			const targetElement = evt.target as HTMLElement;
			const folderTitleEl = targetElement?.closest(".nav-folder-title");
			if (!folderTitleEl) return; // Not a folder

			// The Obsidian file explorer sets 'data-path' on folder elements.
			const folderPath = folderTitleEl.getAttribute("data-path");
			if (!folderPath) return; // No recognized path

			// Check if the path corresponds to a folder. If so, open all child files.
			const maybeFolder = this.app.vault.getAbstractFileByPath(folderPath);
			if (maybeFolder instanceof TFolder) {
				this.openAllFilesInFolder(maybeFolder);

				// Prevent Obsidian from its default handling of ctrl-click on the folder.
				evt.preventDefault();
				evt.stopPropagation();
			}
		});
	}

	/**
	 * Opens every file recursively inside the given folder.
	 */
	private openAllFilesInFolder(folder: TFolder): void {
		// Recursively grab all TFile children in this folder
		const files: TFile[] = this.getAllFilesRecursively(folder);

		// Use the built-in openLinkText or open a new leaf, etc.
		for (const file of files) {
			this.app.workspace.openLinkText(file.path, file.path);
		}
	}

	/**
	 * Recursively collects all TFile instances in a folder.
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
		console.log("Unloading CtrlClickOpenAllPlugin.");
	}
}
