import { App, Plugin, TFile, TFolder, WorkspaceLeaf, PluginSettingTab, Setting, Keymap, Notice } from 'obsidian';

interface FolderLayoutSettings {
    saveModifier: 'alt' | 'mod' | 'shift' | 'ctrl';
    defaultSplitThreshold: number;
    sidebarHoldKey: 'alt' | 'mod' | 'shift' | 'ctrl';
    openDefaultLayoutKey: 'alt' | 'mod' | 'shift' | 'ctrl';
}

const DEFAULT_SETTINGS: FolderLayoutSettings = {
    saveModifier: 'alt',
    defaultSplitThreshold: 5,
    sidebarHoldKey: 'ctrl',
    openDefaultLayoutKey: 'ctrl',
};

export default class FolderLayoutPlugin extends Plugin {
    settings: FolderLayoutSettings;
    observer: MutationObserver | null = null;
    ctrlHeld: boolean = false; // (Optional) if you want separate Ctrl logic

    /** Tracks if the “sidebar hold” key is currently pressed. */
    private sidebarHeld: boolean = false;

    async onload() {
        console.log('FolderLayoutPlugin loaded.');
        await this.loadSettings();
        this.addSettingTab(new FolderLayoutSettingTab(this.app, this));

        // 1) Manage the "Sidebar Hold Key": forcibly open on keydown, close on keyup
        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            if (this.isSidebarHoldKey(evt) && !this.sidebarHeld) {
                this.sidebarHeld = true;
                this.forceShowLeftSidebar();
            }
        });
        this.registerDomEvent(document, 'keyup', (evt: KeyboardEvent) => {
            if (!this.isSidebarHoldKey(evt) && this.sidebarHeld) {
                this.sidebarHeld = false;
                this.forceHideLeftSidebar();
            }
        });

        // 2) (Optional) Keep existing Ctrl-based logic for “default layout”
        this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
            if (evt.ctrlKey && !this.ctrlHeld) {
                this.ctrlHeld = true;
                document.body.addClass('ctrl-active');
                this.reloadHandlers();
            }
        });
        this.registerDomEvent(document, 'keyup', (evt: KeyboardEvent) => {
            if (!evt.ctrlKey && this.ctrlHeld) {
                this.ctrlHeld = false;
                document.body.removeClass('ctrl-active');
                this.reloadHandlers();
            }
        });

        // 3) Observe changes in the file explorer
        this.observer = new MutationObserver(() => this.reloadHandlers());
        this.observer.observe(document.body, { childList: true, subtree: true });

        // 4) Initial pass
        this.reloadHandlers();
    }

    onunload() {
        console.log('FolderLayoutPlugin unloaded.');
        if (this.observer) this.observer.disconnect();
    }

    //-----------------------------------------
    // 1) Hook folder DOM for custom click logic
    //-----------------------------------------
    private reloadHandlers() {
        const folderTitleEls = document.querySelectorAll('.nav-folder-title:not(.folder-layout-hooked)') as NodeListOf<HTMLElement>;

		// @ts-ignore
        for (const titleEl of folderTitleEls) {
            titleEl.addClass('folder-layout-hooked');
            titleEl.onclick = (evt: MouseEvent) => this.handleFolderClick(evt, titleEl);

            const folderPath = titleEl.getAttribute('data-path');
            if (folderPath) {
                this.updateFolderClass(folderPath);
            }
        }
    }

    /** If there's a layout.json => add .has-folder-layout, else remove it. */
    private async updateFolderClass(folderPath: string) {
        const layoutFilePath = `${folderPath}/layout.json`;
        const hasLayout = await this.app.vault.adapter.exists(layoutFilePath);

        const el = document.querySelector(`.nav-folder-title[data-path="${CSS.escape(folderPath)}"]`);
        if (!el) return;

        if (hasLayout) {
            el.addClass('has-folder-layout');
        } else {
            el.removeClass('has-folder-layout');
        }
    }

    //-----------------------------------------
    // 2) The main folder click logic
    //-----------------------------------------
    /**
     * - If Ctrl is pressed => open *default* layout, ignoring any layout.json
     * - Else if user’s chosen “save modifier” => save layout
     * - Else if folder has a layout => open it
     * - Otherwise => let default expand/collapse happen
     */
    private async handleFolderClick(evt: MouseEvent, titleEl: HTMLElement) {
        const folderPath = titleEl.getAttribute('data-path');
        if (!folderPath) return;
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return;

        // forcibly remove default click, then re-trigger
        if (this.isSaveModifierClick(evt) || this.isOpenDefaultLayoutClick(evt)) {
            (evt.target as HTMLElement).onclick = null;
            (evt.target as HTMLElement).click();
        }

        if (this.isSaveModifierClick(evt)) {
            evt.preventDefault();
            evt.stopPropagation();

            await this.saveFolderLayout(folder);
            this.updateFolderClass(folder.path);
            return;
        }

        const layoutFilePath = `${folder.path}/layout.json`;
        const hasLayout = await this.app.vault.adapter.exists(layoutFilePath);

        if (hasLayout) {
            evt.preventDefault();
            evt.stopPropagation();

            // await this.closeAllMarkdownLeaves();
            await this.openSavedLayout(folder);
            // new Notice("Layout opened.");
        } else {
            if (this.isOpenDefaultLayoutClick(evt)) {
                evt.preventDefault();
                evt.stopPropagation();

                // await this.closeAllMarkdownLeaves();
                await this.openDefaultLayout(folder);
                // new Notice("Opened default layout.");
                return;
            }
        }
    }

    private isSaveModifierClick(evt: MouseEvent): boolean {
        switch (this.settings.saveModifier) {
            case 'alt':
                return evt.altKey;
            case 'mod':
                return Keymap.isModEvent(evt) as boolean;
            case 'shift':
                return evt.shiftKey;
            case 'ctrl':
                return evt.ctrlKey;
        }
        return false;
    }

    private isOpenDefaultLayoutClick(evt: MouseEvent): boolean {
        switch (this.settings.openDefaultLayoutKey) {
            case 'alt':
                return evt.altKey;
            case 'mod':
                return Keymap.isModEvent(evt) as boolean;
            case 'shift':
                return evt.shiftKey;
            case 'ctrl':
                return evt.ctrlKey;
        }
        return false;
    }

    //-----------------------------------------
    // 3) Save layout or load layout
    //-----------------------------------------
    private async saveFolderLayout(folder: TFolder) {
        const folderRoot = folder.path + '/';
        const openPaths = this.getOpenFilePaths();

        for (const p of openPaths) {
            if (!p.startsWith(folderRoot)) {
                new Notice('All open files must be in this folder.');
                return;
            }
        }

        const layoutObj = this.app.workspace.getLayout();
        this.makeLayoutPathsRelative(layoutObj, folder.path);

        const layoutString = JSON.stringify(layoutObj, null, 2);
        const layoutFilePath = `${folder.path}/layout.json`;

        try {
            await this.app.vault.adapter.write(layoutFilePath, layoutString);
            new Notice('Layout saved.');
        } catch (err) {
            console.error(err);
            new Notice('Could not save layout.');
        }
    }

    private async openSavedLayout(folder: TFolder) {
        const layoutFilePath = `${folder.path}/layout.json`;
        const layoutJson = await this.app.vault.adapter.read(layoutFilePath);
        const newLayout = JSON.parse(layoutJson);

        this.makeLayoutPathsAbsolute(newLayout, folder.path);

        const currentLayout = this.app.workspace.getLayout();
        newLayout.left = currentLayout.left;
        newLayout.right = currentLayout.right;
        newLayout['left-ribbon'] = currentLayout['left-ribbon'];
        newLayout['right-ribbon'] = currentLayout['right-ribbon'];

        this.app.workspace.changeLayout(newLayout);
    }

    private async openDefaultLayout(folder: TFolder) {
        const allFiles = this.getAllFilesRecursively(folder);
        if (allFiles.length === 0) {
            new Notice('Folder has no files.');
            return;
        }
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) {
            new Notice('No active leaf.');
            return;
        }
        if (allFiles.length < this.settings.defaultSplitThreshold) {
            await leaf.openFile(allFiles[0]);
            for (let i = 1; i < allFiles.length; i++) {
                const newLeaf = this.app.workspace.splitActiveLeaf('vertical');
                await newLeaf.openFile(allFiles[i]);
            }
        } else {
            await leaf.openFile(allFiles[0]);
            for (let i = 1; i < allFiles.length; i++) {
                await leaf.openFile(allFiles[i], { active: false });
            }
        }
    }

    //-----------------------------------------
    // 4) Utility: close leaves, path transforms
    //-----------------------------------------
    private closeAllMarkdownLeaves() {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            leaf.detach();
        }
    }

    private getOpenFilePaths(): string[] {
        return (
            this.app.workspace
                .getLeavesOfType('markdown')
                // @ts-ignore
                .map((leaf) => leaf.view.file?.path)
                .filter((p): p is string => !!p)
        );
    }

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

    private makeLayoutPathsRelative(layoutObj: any, folderPath: string) {
        this.walkLayoutLeaves(layoutObj, (leaf: any) => {
            if (leaf?.state?.type === 'markdown') {
                const absPath = leaf.state.state?.file;
                if (typeof absPath === 'string') {
                    if (absPath.startsWith(folderPath + '/')) {
                        leaf.state.state.file = absPath.slice(folderPath.length + 1);
                    } else {
                        leaf.state.state.file = null;
                    }
                }
            }
        });
    }

    private makeLayoutPathsAbsolute(layoutObj: any, folderPath: string) {
        this.walkLayoutLeaves(layoutObj, (leaf: any) => {
            if (leaf?.state?.type === 'markdown') {
                const relPath = leaf.state.state?.file;
                if (typeof relPath === 'string' && relPath.length > 0) {
                    leaf.state.state.file = folderPath + '/' + relPath;
                }
            }
        });
    }

    private walkLayoutLeaves(obj: any, callback: (leaf: any) => void) {
        if (!obj) return;
        if (obj.type === 'leaf') {
            callback(obj);
        } else if (Array.isArray(obj.children)) {
            for (const child of obj.children) {
                this.walkLayoutLeaves(child, callback);
            }
        } else {
            if (obj.main) this.walkLayoutLeaves(obj.main, callback);
            if (obj.left) this.walkLayoutLeaves(obj.left, callback);
            if (obj.right) this.walkLayoutLeaves(obj.right, callback);
            if (obj.center) this.walkLayoutLeaves(obj.center, callback);
        }
    }

    //-----------------------------------------
    // 5) Force showing/hiding the left sidebar
    //    by using existing "toggle left sidebar" command
    //-----------------------------------------
    private forceShowLeftSidebar() {
        // If it's already open, do nothing
        if (!this.isLeftSidebarOpen()) {
            // @ts-ignore
            this.app.commands.executeCommandById('app:toggle-left-sidebar');
        }
    }

    private forceHideLeftSidebar() {
        // If it's currently open, toggle it to close
        if (this.isLeftSidebarOpen()) {
            // @ts-ignore
            this.app.commands.executeCommandById('app:toggle-left-sidebar');
        }
    }

    /**
     * Check if the left sidebar is currently open or collapsed.
     * We'll look at (this.app.workspace as any).leftSplit, or
     * see if we can glean from getLeftLeaf(false).
     */
    private isLeftSidebarOpen(): boolean {
        const leftSplit = (this.app.workspace as any).leftSplit;
        if (!leftSplit) return false;
        return leftSplit.collapsed === false;
    }

    //-----------------------------------------
    // 6) Checking if the user is pressing the “sidebarHoldKey”
    //-----------------------------------------
    private isSidebarHoldKey(evt: KeyboardEvent): boolean {
        switch (this.settings.sidebarHoldKey) {
            case 'alt':
                return evt.altKey && !evt.metaKey;
            case 'mod':
                return Keymap.isModEvent(evt) as boolean;
            case 'shift':
                return evt.shiftKey;
            case 'ctrl':
                return evt.ctrlKey && !evt.metaKey;
        }
        return false;
    }

    //-----------------------------------------
    // 7) Settings load/save
    //-----------------------------------------
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class FolderLayoutSettingTab extends PluginSettingTab {
    plugin: FolderLayoutPlugin;

    constructor(app: App, plugin: FolderLayoutPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Folder Layout Settings' });

        // 1) Save Layout Key
        new Setting(containerEl)
            .setName('Save Layout Key')
            .setDesc('Which modifier key to hold when clicking a folder to save the layout.')
            .addDropdown((drop) => {
                drop.addOption('alt', 'Alt');
                drop.addOption('mod', 'Ctrl/Cmd');
                drop.addOption('shift', 'Shift');
                drop.addOption('ctrl', 'Ctrl');
                drop.setValue(this.plugin.settings.saveModifier);
                drop.onChange(async (val: any) => {
                    this.plugin.settings.saveModifier = val;
                    await this.plugin.saveSettings();
                });
            });

        // 2) Vertical Split Threshold
        new Setting(containerEl)
            .setName('Vertical Split Threshold')
            .setDesc('Open up to this many files in vertical splits before switching to tabbed view.')
            .addText((text) => {
                text.setValue(this.plugin.settings.defaultSplitThreshold.toString()).onChange(async (val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) {
                        this.plugin.settings.defaultSplitThreshold = num;
                        await this.plugin.saveSettings();
                    }
                });
            });

        // 3) Sidebar Hold Key
        new Setting(containerEl)
            .setName('Sidebar Hold Key')
            .setDesc('Which modifier key to hold down to temporarily show the left sidebar.')
            .addDropdown((drop) => {
                drop.addOption('alt', 'Alt');
                drop.addOption('mod', 'Ctrl/Cmd');
                drop.addOption('shift', 'Shift');
                drop.addOption('ctrl', 'Ctrl');
                drop.setValue(this.plugin.settings.sidebarHoldKey);
                drop.onChange(async (val: any) => {
                    this.plugin.settings.sidebarHoldKey = val;
                    await this.plugin.saveSettings();
                });
            });
    }
}
