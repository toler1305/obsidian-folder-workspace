import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
	Keymap,
	Notice
} from "obsidian";

// How many files will open in vertical splits before switching to tabs
const MAX_FILE_AMOUNT_TO_OPEN_AS_SPLIT_PANES = 5;

/**
 * Define the plugin's settings interface.
 */
interface FolderWorkspaceSettings {
	openHotkey: "alt" | "mod" | "shift" | "ctrl";
	saveHotkey: "alt" | "mod" | "shift" | "ctrl";
}

const DEFAULT_SETTINGS: FolderWorkspaceSettings = {
	openHotkey: "mod",
	saveHotkey: "alt",
};

export default class FolderWorkspacePlugin extends Plugin {
	private settings: FolderWorkspaceSettings;

	async onload() {
		console.log("Folder Workspace plugin loaded.");

		// Load plugin settings
		await this.loadSettings();
		this.addSettingTab(new FolderWorkspaceSettingTab(this.app, this));

		// Listen for clicks in the file explorer
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			const folderTitleEl = target?.closest(".nav-folder-title");
			if (!folderTitleEl) return; // Not a folder in the explorer

			const folderPath = folderTitleEl.getAttribute("data-path");
			if (!folderPath) return;

			const maybeFolder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(maybeFolder instanceof TFolder)) return;

			// Check which hotkey is used
			if (this.isHotkey(evt, this.settings.saveHotkey)) {
				// Save layout
				evt.preventDefault();
				evt.stopPropagation();
				void this.saveFolderLayout(maybeFolder);
			} else if (this.isHotkey(evt, this.settings.openHotkey)) {
				// Open layout
				evt.preventDefault();
				evt.stopPropagation();
				void this.openFolderLayout(maybeFolder);
			}
		});
	}

	/** Determine if the user pressed the configured hotkey (alt, mod, shift, or ctrl). */
	private isHotkey(evt: MouseEvent, hotkey: string): boolean {
		switch (hotkey) {
			case "alt":  return evt.altKey;
			case "mod":  return Keymap.isModEvent(evt);
			case "shift":return evt.shiftKey;
			case "ctrl": return evt.ctrlKey; // Typically on Windows, but "mod" might handle that
			default:     return false;
		}
	}

	/** Save the current layout to layout.json in the folder, but store file paths relative to that folder. */
	private async saveFolderLayout(folder: TFolder) {
		const openFilePaths = this.getOpenFilePaths();
		const folderRoot = folder.path + "/";

		// Ensure all open files are children of this folder
		for (const filePath of openFilePaths) {
			if (!filePath.startsWith(folderRoot)) {
				new Notice(`All open files must be inside "${folder.name}".`);
				return;
			}
		}

		// Get entire workspace layout
		const layoutObj = this.app.workspace.getLayout();
		// Convert absolute paths to relative
		this.makeLayoutPathsRelative(layoutObj, folder.path);

		// Stringify layout
		const layoutJson = JSON.stringify(layoutObj, null, 2);
		const layoutFilePath = `${folder.path}/layout.json`;

		try {
			await this.app.vault.adapter.write(layoutFilePath, layoutJson);
			new Notice("Layout saved.");
		} catch (error) {
			console.error(error);
			new Notice("Could not save layout.");
		}
	}

	/** Open the layout if it exists; otherwise use the default layout. */
	private async openFolderLayout(folder: TFolder) {
		// Close all open tabs first
		this.closeAllMarkdownLeaves();

		// Check if layout.json exists
		const layoutFilePath = `${folder.path}/layout.json`;
		const exists = await this.app.vault.adapter.exists(layoutFilePath);

		if (!exists) {
			// No saved layout => open the folder in default layout
			new Notice(`No saved layout found for "${folder.name}".`);
			await this.openDefaultLayout(folder);
			return;
		}

		try {
			// Read the JSON from disk
			const layoutJson = await this.app.vault.adapter.read(layoutFilePath);
			const layoutObj = JSON.parse(layoutJson);

			// Convert relative paths back to absolute
			this.makeLayoutPathsAbsolute(layoutObj, folder.path);

			// Restore entire workspace
			this.app.workspace.changeLayout(layoutObj);
			new Notice("Layout opened.");
		} catch (error) {
			console.error(error);
			new Notice("Could not open layout.");
		}
	}

	/**
	 * Default layout:
	 * - If fewer than MAX_FILE_AMOUNT_TO_OPEN_AS_SPLIT_PANES, open them vertically.
	 * - Otherwise, open them all in tabs in one pane.
	 */
	private async openDefaultLayout(folder: TFolder) {
		const allFiles = this.getAllFilesRecursively(folder);
		if (allFiles.length === 0) {
			new Notice("No files found.");
			return;
		}

		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) {
			new Notice("No place to open files.");
			return;
		}

		if (allFiles.length < MAX_FILE_AMOUNT_TO_OPEN_AS_SPLIT_PANES) {
			// Vertical splits (top-to-bottom stack)
			await leaf.openFile(allFiles[0]);
			for (let i = 1; i < allFiles.length; i++) {
				const newLeaf = this.app.workspace.splitActiveLeaf("vertical");
				await newLeaf.openFile(allFiles[i]);
			}
		} else {
			// Open them all as tabs in the same pane
			await leaf.openFile(allFiles[0]);
			for (let i = 1; i < allFiles.length; i++) {
				await leaf.openFile(allFiles[i], { active: false });
			}
		}
	}

	/** Close all Markdown leaves/tabs. */
	private closeAllMarkdownLeaves() {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			leaf.detach();
		}
	}

	/** Returns the file paths of all open Markdown tabs. */
	private getOpenFilePaths(): string[] {
		const result: string[] = [];
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const file = leaf.view.file;
			if (file) result.push(file.path);
		}
		return result;
	}

	/** Recursively collect all TFile objects inside the given folder. */
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

	//------------------------------------------------------------------
	// Path Transformations: Absolute <--> Relative
	//------------------------------------------------------------------

	/**
	 * Walk the layout object. Every time we see a leaf whose type is "markdown"
	 * and has a "file", transform that file path from absolute to relative.
	 */
	private makeLayoutPathsRelative(layoutObj: any, folderPath: string) {
		this._walkLayoutLeaves(layoutObj, (leaf) => {
			if (leaf?.state?.type === "markdown") {
				const absPath = leaf.state.state?.file;
				if (typeof absPath === "string") {
					// If the file is inside folderPath, strip that prefix
					if (absPath.startsWith(folderPath + "/")) {
						const relativePath = absPath.slice(folderPath.length + 1);
						leaf.state.state.file = relativePath;
					} else {
						// If file is outside the folder, we remove it or set it to null
						leaf.state.state.file = null;
					}
				}
			}
		});
	}

	/**
	 * Walk the layout object. Every time we see a leaf whose type is "markdown"
	 * and has a "file", transform that file path from relative to absolute (prefixed with folderPath).
	 */
	private makeLayoutPathsAbsolute(layoutObj: any, folderPath: string) {
		this._walkLayoutLeaves(layoutObj, (leaf) => {
			if (leaf?.state?.type === "markdown") {
				const relPath = leaf.state.state?.file;
				if (typeof relPath === "string" && relPath.length > 0) {
					// Convert relative path to absolute
					leaf.state.state.file = folderPath + "/" + relPath;
				}
			}
		});
	}

	/**
	 * Utility to walk all leaves in the layout, calling a callback on each leaf.
	 */
	private _walkLayoutLeaves(layoutObj: any, leafCallback: (leaf: any) => void) {
		if (!layoutObj) return;

		if (layoutObj.type === "leaf") {
			leafCallback(layoutObj);
		} else if (layoutObj.children && Array.isArray(layoutObj.children)) {
			for (const child of layoutObj.children) {
				this._walkLayoutLeaves(child, leafCallback);
			}
		} else {
			// Also handle left, right, etc. in the root layout object
			if (layoutObj.main) {
				this._walkLayoutLeaves(layoutObj.main, leafCallback);
			}
			if (layoutObj.left) {
				this._walkLayoutLeaves(layoutObj.left, leafCallback);
			}
			if (layoutObj.right) {
				this._walkLayoutLeaves(layoutObj.right, leafCallback);
			}
			if (layoutObj.center) {
				this._walkLayoutLeaves(layoutObj.center, leafCallback);
			}
		}
	}

	//------------------------------------------------------------------
	// Plugin Settings
	//------------------------------------------------------------------
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * A simple settings tab with two drop-downs to change the hotkeys for
 * saving and opening layouts.
 */
class FolderWorkspaceSettingTab extends PluginSettingTab {
	plugin: FolderWorkspacePlugin;

	constructor(app: App, plugin: FolderWorkspacePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Folder Workspace Settings" });

		// Options for hotkeys
		const hotkeyOptions: Array<["alt"|"mod"|"shift"|"ctrl", string]> = [
			["alt",   "Alt key"],
			["mod",   "Ctrl/Cmd key"],
			["shift", "Shift key"],
			["ctrl",  "Ctrl key"]
		];

		// Setting: Open Layout Hotkey
		new Setting(containerEl)
			.setName("Open Layout Hotkey")
			.setDesc("Choose which modifier key to use when clicking a folder to open its layout.")
			.addDropdown(dropdown => {
				hotkeyOptions.forEach(([value, label]) => {
					dropdown.addOption(value, label);
				});
				dropdown.setValue(this.plugin.settings.openHotkey);
				dropdown.onChange(async (value: "alt"|"mod"|"shift"|"ctrl") => {
					this.plugin.settings.openHotkey = value;
					await this.plugin.saveSettings();
				});
			});

		// Setting: Save Layout Hotkey
		new Setting(containerEl)
			.setName("Save Layout Hotkey")
			.setDesc("Choose which modifier key to use when clicking a folder to save its layout.")
			.addDropdown(dropdown => {
				hotkeyOptions.forEach(([value, label]) => {
					dropdown.addOption(value, label);
				});
				dropdown.setValue(this.plugin.settings.saveHotkey);
				dropdown.onChange(async (value: "alt"|"mod"|"shift"|"ctrl") => {
					this.plugin.settings.saveHotkey = value;
					await this.plugin.saveSettings();
				});
			});
	}
}
