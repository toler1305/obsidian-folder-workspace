import { App, Plugin, PluginSettingTab, Setting, TFile, TFolder, Notice } from 'obsidian';

/** Plugin-wide settings */
interface FolderLayoutSettings {
    saveModifierKey: string; // e.g. "Alt", "CapsLock", or "disabled"
    defaultSplitThreshold: number; // open N files in splits before tabbing
    sidebarHoldKey: string; // "CapsLock" or "disabled"
    openWorkspaceKey: string; // "CapsLock" or "disabled"
}

/** Defaults merged with saved data at load time. */
const DEFAULT_SETTINGS: FolderLayoutSettings = {
    saveModifierKey: 'Alt',
    defaultSplitThreshold: 5,
    sidebarHoldKey: 'CapsLock',
    openWorkspaceKey: 'CapsLock',
};

export default class FolderLayoutPlugin extends Plugin {
    settings: FolderLayoutSettings;
    private observer: MutationObserver | null = null;
    private pressedKeys = new Set<string>();

    /** Called by Obsidian when loading the plugin. */
    async onload() {
        console.log('FolderLayoutPlugin loaded.');
        await this.loadSettings(); // <-- Make sure loadSettings exists

        this.addSettingTab(new FolderLayoutSettingTab(this.app, this));

        // Track pressed keys
        this.registerDomEvent(document, 'keydown', (evt) => this.handleKeyDown(evt));
        this.registerDomEvent(document, 'keyup', (evt) => this.handleKeyUp(evt));

        // Clear pressed keys on window blur/focus
        this.registerDomEvent(window, 'blur', () => this.clearPressedKeys());
        this.registerDomEvent(window, 'focus', () => this.clearPressedKeys());

        // Observe changes in the file explorer to attach click handlers
        this.observer = new MutationObserver(() => this.reloadHandlers());
        this.observer.observe(document.body, { childList: true, subtree: true });

        // Initial pass
        this.reloadHandlers();
    }

    /** Called by Obsidian when unloading the plugin. */
    onunload() {
        if (this.observer) this.observer.disconnect();
        console.log('FolderLayoutPlugin unloaded.');
    }

    //========================================================
    // SETTINGS (LOAD / SAVE)
    //========================================================
    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    //========================================================
    // KEY DOWN / KEY UP
    //========================================================
    private handleKeyDown(evt: KeyboardEvent) {
        if (this.pressedKeys.has(evt.key)) return;
        this.pressedKeys.add(evt.key);

        // Show sidebar if sidebarHoldKey is active
        if (this.isSidebarHoldKey(evt.key)) {
            this.forceShowLeftSidebar();
        }

        // If openWorkspaceKey is active => add "is-workspace-opener-on-hover"
        if (this.isOpenWorkspaceKey(evt.key)) {
            document.querySelectorAll('.nav-file-title, .nav-folder-title').forEach((el) => el.addClass('is-workspace-opener-on-hover'));
        }
    }

    private handleKeyUp(evt: KeyboardEvent) {
        if (!this.pressedKeys.has(evt.key)) return;
        this.pressedKeys.delete(evt.key);

        // Hide sidebar if releasing sidebarHoldKey
        if (this.isSidebarHoldKey(evt.key)) {
            this.forceHideLeftSidebar();
        }

        // If releasing openWorkspaceKey => remove "is-workspace-opener-on-hover"
        if (this.isOpenWorkspaceKey(evt.key)) {
            this.updateClasses();
        }
    }

    //========================================================
    // HANDLE CLASSES
    //========================================================

    private updateClasses() {
        const isOpenWorkspaceKeyActive = this.isOpenWorkspaceKeyActive();

        if (isOpenWorkspaceKeyActive) {
            document
                .querySelectorAll('.nav-file-title, .nav-folder-title')
                .forEach((el) => this.ensureClassExists(el as HTMLElement, 'is-workspace-opener-on-hover'));
        } else {
            document
                .querySelectorAll('.nav-file-title, .nav-folder-title')
                .forEach((el) => this.ensureClassDoesNotExist(el as HTMLElement, 'is-workspace-opener-on-hover'));
        }
    }

    private ensureClassExists(el: HTMLElement, className: string) {
        if (el.classList.contains(className)) return;
        el.classList.add(className);
    }

    private ensureClassDoesNotExist(el: HTMLElement, className: string) {
        if (!el.classList.contains(className)) return;
        el.classList.remove(className);
    }

    //========================================================
    // ATTACH CLICK HANDLERS
    //========================================================
    private reloadHandlers() {
        // Folders
        const folderEls = document.querySelectorAll('.nav-folder-title:not(.workspace-opener-hooked)') as NodeListOf<HTMLElement>;

        folderEls.forEach((el) => {
            el.addClass('workspace-opener-hooked');
            el.onclick = (evt: MouseEvent) => this.handleFolderClick(evt, el);
            const folderPath = el.getAttribute('data-path');
            if (folderPath) this.updateFolderLayoutClass(folderPath);
        });

        // Files
        const fileEls = document.querySelectorAll('.nav-file-title:not(.workspace-opener-hooked)') as NodeListOf<HTMLElement>;

        fileEls.forEach((el) => {
            el.addClass('workspace-opener-hooked');
            el.onclick = (evt: MouseEvent) => this.handleFileClick(evt, el);
        });
    }

    //========================================================
    // FOLDER CLICK
    //========================================================
    private async handleFolderClick(evt: MouseEvent, el: HTMLElement) {
        const folderPath = el.getAttribute('data-path');
        if (!folderPath) return;
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return;

        // If neither "save" nor "open" key is pressed => let Obsidian handle expand/collapse
        if (!this.isSaveModifierKeyActive() && !this.isOpenWorkspaceKeyActive()) {
            return;
        }

        evt.preventDefault();
        evt.stopPropagation();

        // If "save" key => save layout
        if (this.isSaveModifierKeyActive()) {
            await this.saveFolderLayout(folder);
            this.updateFolderLayoutClass(folder.path);
            return;
        }

        // If "open" key => open saved layout if present, else open default workspace
        if (this.isOpenWorkspaceKeyActive()) {
            this.openFolderOrSavedLayout(folder);
            return;
        }
    }

    //========================================================
    // FILE CLICK
    //========================================================
    private async handleFileClick(evt: MouseEvent, el: HTMLElement) {
        if (!this.isOpenWorkspaceKeyActive()) {
            // Let Obsidian open the file normally
            return;
        }

        evt.preventDefault();
        evt.stopPropagation();

        const filePath = el.getAttribute('data-path');
        if (!filePath) return;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return;

        const mainLeaves = [...this.app.workspace.getLeavesOfType('markdown'), ...this.app.workspace.getLeavesOfType('empty')];
        if (mainLeaves.length > 1) {
            const lastLeaf = mainLeaves.pop();
            mainLeaves.forEach((leaf) => leaf.detach());
            if (lastLeaf) await lastLeaf.openFile(file);
        } else {
            await this.app.workspace.getMostRecentLeaf()?.openFile(file);
        }
    }

    //========================================================
    // OPEN FOLDER OR SAVED LAYOUT
    //========================================================
    private async openFolderOrSavedLayout(folder: TFolder) {
        const layoutPath = `${folder.path}/layout.json`;
        const hasLayout = await this.app.vault.adapter.exists(layoutPath);

        if (hasLayout) {
            this.openSavedLayout(folder);
        } else {
            this.openDefaultWorkspace(folder);
        }
        setTimeout(() => this.updateClasses(), 100);
    }

    //========================================================
    // SAVE LAYOUT
    //========================================================
    private async saveFolderLayout(folder: TFolder) {
        const folderRoot = folder.path + '/';
        const openPaths = this.getOpenFilePaths();

        // If any open file is outside this folder => refuse
        for (const p of openPaths) {
            if (!p.startsWith(folderRoot)) {
                new Notice('All open files must be in this folder to save layout.');
                return;
            }
        }

        const layout = this.app.workspace.getLayout();
        this.makeLayoutPathsRelative(layout, folder.path);

        try {
            await this.app.vault.adapter.write(`${folder.path}/layout.json`, JSON.stringify(layout, null, 2));
            new Notice('Layout saved.');
        } catch (err) {
            console.error('Could not save layout:', err);
            new Notice('Error saving layout. See console for details.');
        }
    }

    //========================================================
    // OPEN SAVED LAYOUT
    //========================================================
    private async openSavedLayout(folder: TFolder) {
        const layoutPath = `${folder.path}/layout.json`;
        const raw = await this.app.vault.adapter.read(layoutPath);
        const newLayout = JSON.parse(raw);

        // Convert relative -> absolute
        this.makeLayoutPathsAbsolute(newLayout, folder.path);

        // Preserve ribbons
        const cur = this.app.workspace.getLayout();
        newLayout.left = cur.left;
        newLayout.right = cur.right;
        newLayout['left-ribbon'] = cur['left-ribbon'];
        newLayout['right-ribbon'] = cur['right-ribbon'];

        try {
            this.app.workspace.changeLayout(newLayout);
        } catch (error) {
            console.error('Error applying workspace layout:', error);
            new Notice('Error applying workspace layout. See console for details.');
        }
    }

    //========================================================
    // OPEN DEFAULT WORKSPACE (ALL FILES)
    //========================================================
    private async openDefaultWorkspace(folder: TFolder) {
        // this.closeAllMarkdownLeaves();

        const allFiles = this.getAllFilesRecursively(folder);
        if (allFiles.length === 0) {
            new Notice('Folder has no files.');
            return;
        }

        const mainLeaves = [...this.app.workspace.getLeavesOfType('markdown'), ...this.app.workspace.getLeavesOfType('empty')];
        if (mainLeaves.length > 1) {
            const lastLeaf = mainLeaves.pop()!;
            mainLeaves.forEach((leaf) => leaf.detach());
            await lastLeaf.openFile(allFiles[0]);
        } else {
            await this.app.workspace.getMostRecentLeaf()?.openFile(allFiles[0]);
        }

        if (allFiles.length < this.settings.defaultSplitThreshold) {
            // const markdownLeaves = this.app.workspace.getLeavesOfType('markdown')

            // const lastLeaf = markdownLeaves.pop();
            // markdownLeaves.forEach((leaf) => leaf.detach());
            // if (lastLeaf) await lastLeaf.openFile(allFiles[0]);
            // for (let i = 1; i < allFiles.length; i++) {
            //     const newLeaf = this.app.workspace.splitActiveLeaf('vertical');
            //     await newLeaf.openFile(allFiles[i]);
            // }

           

            for (let i = 1; i < allFiles.length; i++) {
                const newLeaf = this.app.workspace.splitActiveLeaf('vertical');
                await newLeaf.openFile(allFiles[i]);
            }
        } else {
            for (let i = 1; i < allFiles.length; i++) {
                const leaf = this.app.workspace.getMostRecentLeaf();
                if (!leaf) continue;
                await leaf.openFile(allFiles[i], { active: false });
            }
        }
    }

    //========================================================
    // UTILITIES
    //========================================================
    private closeAllMarkdownLeaves() {
        this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => leaf.detach());
    }

    private getOpenFilePaths(): string[] {
        return this.app.workspace
            .getLeavesOfType('markdown')
            // @ts-ignore
            .map((leaf) => leaf.view.file?.path)
            .filter((p): p is string => !!p);
    }

    private getAllFilesRecursively(folder: TFolder): TFile[] {
        let result: TFile[] = [];
        for (const child of folder.children) {
            if (child instanceof TFile) result.push(child);
            if (child instanceof TFolder) result.push(...this.getAllFilesRecursively(child));
        }
        return result;
    }

    /** Underline folders that have layout.json */
    private async updateFolderLayoutClass(folderPath: string) {
        if (!folderPath) return;
        const el = document.querySelector(`[data-path="${CSS.escape(folderPath)}"]`);
        if (!el) return;

        const layoutPath = `${folderPath}/layout.json`;
        const hasLayout = await this.app.vault.adapter.exists(layoutPath);

        if (hasLayout) el.addClass('folder-has-layout');
        else el.removeClass('folder-has-layout');
    }

    /** Convert absolute paths in layout to relative paths. */
    private makeLayoutPathsRelative(layout: any, folderPath: string) {
        this.walkLayoutLeaves(layout, (leaf) => {
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

    /** Convert relative paths in layout to absolute paths. */
    private makeLayoutPathsAbsolute(layout: any, folderPath: string) {
        this.walkLayoutLeaves(layout, (leaf) => {
            if (leaf?.state?.type === 'markdown') {
                const relPath = leaf.state.state?.file;
                if (typeof relPath === 'string' && relPath.length > 0) {
                    leaf.state.state.file = folderPath + '/' + relPath;
                }
            }
        });
    }

    /** Recursively walk layout leaves. */
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

    private clearPressedKeys() {
        if (this.pressedKeys.size === 0) return;
        this.pressedKeys.clear();

        // Remove bold highlight from all items
        document.querySelectorAll('.nav-file-title, .nav-folder-title').forEach((el) => el.removeClass('is-workspace-opener-on-hover'));
    }

    private isSidebarHoldKey(k: string): boolean {
        return this.settings.sidebarHoldKey !== 'disabled' && k === this.settings.sidebarHoldKey;
    }
    private isOpenWorkspaceKey(k: string): boolean {
        return this.settings.openWorkspaceKey !== 'disabled' && k === this.settings.openWorkspaceKey;
    }
    private isSaveModifierKeyActive(): boolean {
        const key = this.settings.saveModifierKey;
        return key !== 'disabled' && this.pressedKeys.has(key);
    }
    private isOpenWorkspaceKeyActive(): boolean {
        const key = this.settings.openWorkspaceKey;
        return key !== 'disabled' && this.pressedKeys.has(key);
    }

    // Toggle sidebar
    private forceShowLeftSidebar() {
        if (!this.isLeftSidebarOpen()) {
            // @ts-ignore
            this.app.commands.executeCommandById('app:toggle-left-sidebar');
        }
    }
    private forceHideLeftSidebar() {
        if (this.isLeftSidebarOpen()) {
            // @ts-ignore
            this.app.commands.executeCommandById('app:toggle-left-sidebar');
        }
    }
    private isLeftSidebarOpen(): boolean {
        const leftSplit = (this.app.workspace as any).leftSplit;
        return leftSplit && leftSplit.collapsed === false;
    }
}

/** Settings tab with "Capture Key" and "Clear Hotkey" buttons. */
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
        this.addKeySetting({
            container: containerEl,
            name: 'Save Layout Key',
            description: 'Key for saving folder layout (or "disabled").',
            getValue: () => this.plugin.settings.saveModifierKey,
            setValue: (val) => {
                this.plugin.settings.saveModifierKey = val;
                this.plugin.saveSettings();
            },
        });

        // 2) Vertical Split Threshold
        new Setting(containerEl)
            .setName('Vertical Split Threshold')
            .setDesc('Open up to this many files in vertical splits before switching to tabbed view.')
            .addText((text) => {
                text.inputEl.type = 'number';
                text.setValue(this.plugin.settings.defaultSplitThreshold.toString());
                text.onChange(async (val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num)) {
                        this.plugin.settings.defaultSplitThreshold = num;
                        await this.plugin.saveSettings();
                    }
                });
            });

        // 3) Sidebar Hold Key
        this.addKeySetting({
            container: containerEl,
            name: 'Sidebar Hold Key',
            description: 'Key to show sidebar while held, or "disabled".',
            getValue: () => this.plugin.settings.sidebarHoldKey,
            setValue: (val) => {
                this.plugin.settings.sidebarHoldKey = val;
                this.plugin.saveSettings();
            },
        });

        // 4) Open Workspace Key
        this.addKeySetting({
            container: containerEl,
            name: 'Open Workspace Key',
            description: 'Key to open saved or default workspace, or "disabled".',
            getValue: () => this.plugin.settings.openWorkspaceKey,
            setValue: (val) => {
                this.plugin.settings.openWorkspaceKey = val;
                this.plugin.saveSettings();
            },
        });
    }

    /** Helper: "Capture Key" + "Clear Hotkey" (sets to "disabled"). */
    private addKeySetting(opts: {
        container: HTMLElement;
        name: string;
        description: string;
        getValue: () => string;
        setValue: (val: string) => void;
    }) {
        const { container, name, description, getValue, setValue } = opts;
        const setting = new Setting(container).setName(name).setDesc(description);

        // "Capture Key" button
        setting.addExtraButton((btn) => {
            btn.setIcon('pencil');
            btn.setTooltip('Capture new key');
            btn.onClick(() => {
                new Notice(`Press any key to set "${name}"...`);
                const listener = (evt: KeyboardEvent) => {
                    setValue(evt.key);
                    displayEl.textContent = `Current key: ${evt.key}`;
                    new Notice(`Saved key: ${evt.key}`);
                    window.removeEventListener('keydown', listener, true);
                };
                window.addEventListener('keydown', listener, true);
            });
        });

        // "Clear Hotkey" => sets to "disabled"
        setting.addExtraButton((btn) => {
            btn.setIcon('cross');
            btn.setTooltip('Clear hotkey');
            btn.onClick(() => {
                setValue('disabled');
                displayEl.textContent = `Current key: disabled`;
                new Notice(`Key cleared (disabled).`);
            });
        });

        // Display current key
        const displayEl = container.createEl('div', {
            text: `Current key: ${getValue()}`,
            cls: 'setting-item-description',
        });
    }
}
