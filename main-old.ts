    import {
        App,
        Plugin,
        TFile,
        TFolder,
        MarkdownView,
        WorkspaceLeaf,
        Notice,
        PluginSettingTab,
        Setting,
        Modal,
        ButtonComponent,
        TextComponent
    } from 'obsidian';

    // Define the settings interface
    interface SimpleRamblesPluginSettings {
        showDevNotices: boolean;
        ramblesFolderPath: string;
        rambleFileFormat: string; // New setting for ramble file format
    }

    // Define default settings
    const DEFAULT_SETTINGS: SimpleRamblesPluginSettings = {
        showDevNotices: true,
        ramblesFolderPath: 'rambles',
        rambleFileFormat: '{RELATIVE_PATH}/{FILENAME}.ramble.md', // Default format maintains folder structure
    };

    export default class SimpleRamblesPlugin extends Plugin {
        private settings: SimpleRamblesPluginSettings;
        private rambleLeaf: WorkspaceLeaf | null = null;
        private currentRambleFile: TFile | null = null;

        async onload() {
            console.log('SimpleRamblesPlugin loaded');

            // Load and apply settings
            await this.loadSettings();

            // Add settings tab
            this.addSettingTab(new SimpleRamblesSettingsTab(this.app, this));

            // Ensure the rambles folder exists (including nested folders)
            await this.ensureRamblesFolder();

            // Register event listeners
            this.registerEvent(
                this.app.workspace.on('active-leaf-change', this.handleActiveLeafChange.bind(this))
            );

            // Register event listeners for file and folder renames, and deletions
            this.registerEvent(this.app.vault.on('rename', this.handleFileOrFolderRename.bind(this)));
            this.registerEvent(this.app.vault.on('delete', this.handleFileOrFolderDelete.bind(this)));

            // Initialize by handling the current active leaf
            this.handleActiveLeafChange();

            // Reconcile ramble files on plugin load
            await this.reconcileRambleFiles();
        }

        onunload() {
            console.log('SimpleRamblesPlugin unloaded');
        }

        /**
         * Load the plugin settings.
         */
        async loadSettings() {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        }

        /**
         * Save the plugin settings.
         */
        async saveSettings() {
            await this.saveData(this.settings);
        }

        /**
         * Get the current settings.
         */
        public getSettings(): SimpleRamblesPluginSettings {
            return this.settings;
        }

        /**
         * Update a specific setting.
         * @param key The key of the setting to update.
         * @param value The new value for the setting.
         */
        public updateSetting<K extends keyof SimpleRamblesPluginSettings>(
            key: K,
            value: SimpleRamblesPluginSettings[K]
        ): void {
            this.settings[key] = value;
        }

        /**
         * Ensures that the rambles folder exists in the vault, including any nested folders.
         */
        private async ensureRamblesFolder() {
            const ramblesFolderPath = this.settings.ramblesFolderPath;
            const folders = ramblesFolderPath.split('/');

            let currentPath = '';
            for (const folder of folders) {
                currentPath = currentPath ? `${currentPath}/${folder}` : folder;
                const existingFolder = this.app.vault.getAbstractFileByPath(currentPath);
                if (!existingFolder) {
                    try {
                        await this.app.vault.createFolder(currentPath);
                        this.showNotice(`Created folder: ${currentPath}`);
                    } catch (error) {
                        this.showNotice(`Failed to create folder: ${currentPath}`);
                        console.error(`Failed to create folder: ${currentPath}`, error);
                    }
                } else if (!(existingFolder instanceof TFolder)) {
                    this.showNotice(`Path "${currentPath}" exists but is not a folder.`);
                    return;
                }
            }
        }

        /**
         * Handles changes to the active leaf (e.g., when a different file is opened).
         */
        private async handleActiveLeafChange(leaf?: WorkspaceLeaf) {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                return;
            }

            const activeFile = activeView.file;
            if (!activeFile || activeFile.parent?.path.startsWith(this.settings.ramblesFolderPath)) {
                // Ignore files within the rambles folder
                return;
            }

            const rambleFilePath = this.getRambleFilePath(activeFile);

            // Open or create the ramble file
            let rambleFile = this.app.vault.getAbstractFileByPath(rambleFilePath) as TFile | null;
            if (!rambleFile) {
                // Ensure the subfolders for the ramble file exist
                const rambleFolderPath = this.getRambleFolderPath(rambleFilePath);
                await this.ensureSubfolderExists(rambleFolderPath);

                // Create the ramble file if it doesn't exist (start empty)
                await this.app.vault.create(rambleFilePath, '');
                rambleFile = this.app.vault.getAbstractFileByPath(rambleFilePath) as TFile;
                this.showNotice(`Created ramble file: ${rambleFilePath}`);
            }

            // Open the ramble file in the dedicated ramble leaf
            await this.openRambleFile(rambleFile);

            // Focus the originally active leaf
            if (leaf) {
                this.app.workspace.setActiveLeaf(leaf);
                if (leaf.view instanceof MarkdownView) {
                    leaf.view.editor.focus();
                }
            }
        }

        /**
         * Ensures that a specific subfolder exists, creating it if necessary.
         * @param folderPath The path of the subfolder to ensure.
         */
        private async ensureSubfolderExists(folderPath: string) {
            const folders = folderPath.split('/');

            let currentPath = '';
            for (const folder of folders) {
                currentPath = currentPath ? `${currentPath}/${folder}` : folder;
                const existingFolder = this.app.vault.getAbstractFileByPath(currentPath);
                if (!existingFolder) {
                    try {
                        await this.app.vault.createFolder(currentPath);
                        this.showNotice(`Created folder: ${currentPath}`);
                    } catch (error) {
                        this.showNotice(`Failed to create folder: ${currentPath}`);
                        console.error(`Failed to create folder: ${currentPath}`, error);
                    }
                } else if (!(existingFolder instanceof TFolder)) {
                    this.showNotice(`Path "${currentPath}" exists but is not a folder.`);
                    return;
                }
            }
        }

        /**
         * Constructs the ramble file path for a given file based on the current format.
         * Maintains the original folder structure within the rambles folder.
         * @param file The original file.
         * @returns The corresponding ramble file path.
         */
        private getRambleFilePath(file: TFile): string {
            const format = this.settings.rambleFileFormat;
            const relativePath = this.getRelativePath(file);
            const formattedName = format
                .replace('{FILENAME}', file.basename)
                .replace('{RELATIVE_PATH}', relativePath);
            return `${this.settings.ramblesFolderPath}/${formattedName}`;
        }

        /**
         * Gets the relative path of a file with respect to the vault root.
         * Preserves the folder structure to prevent naming collisions.
         * @param file The original file.
         * @returns The relative path without the file name.
         */
        private getRelativePath(file: TFile): string {
            const parentFolder = file.parent;
            if (!parentFolder) return 'root'; // If the file is at the vault root

            return parentFolder.path; // Preserve the folder structure
        }

        /**
         * Opens the specified ramble file in a dedicated ramble leaf.
         * Reuses the existing leaf if it exists.
         * @param rambleFile The ramble file to open.
         */
        private async openRambleFile(rambleFile: TFile) {
            if (this.currentRambleFile?.path === rambleFile.path) {
                // Ramble file is already open
                return;
            }

            if (!this.rambleLeaf) {
                // Create a new leaf for rambles if it doesn't exist
                this.rambleLeaf = this.app.workspace.getRightLeaf(false);
            }

            // Set the ramble file in the existing ramble leaf
            await this.rambleLeaf?.openFile(rambleFile);
            this.currentRambleFile = rambleFile;
        }

        /**
         * Handles file and folder rename events to update the corresponding ramble file names.
         * Now supports nested rambles and preserves old rambles when moving files or folders.
         * @param file The file or folder that was renamed.
         * @param oldPath The old file or folder path.
         */
        private async handleFileOrFolderRename(file: TFile | TFolder, oldPath: string) {
            // Ignore renames within the rambles folder
            if (file.parent?.path.startsWith(this.settings.ramblesFolderPath)) {
                return;
            }

            if (file instanceof TFolder) {
                // Handle folder renames/moves
                await this.handleFolderRename(file, oldPath);
            } else if (file instanceof TFile) {
                // Handle file renames/moves
                await this.handleSingleFileRename(file, oldPath);
            }
        }

        /**
         * Handles renaming or moving of a single file.
         * @param file The file that was renamed or moved.
         * @param oldPath The old file path.
         */
        private async handleSingleFileRename(file: TFile, oldPath: string) {
            const oldRamblePath = this.getRambleFilePathByOriginalPath(oldPath);
            const newRamblePath = this.getRambleFilePath(file);

            // Determine if the file was moved to a different folder
            const oldFolderPath = this.getFolderPathFromPath(oldPath);
            const newFolderPath = this.getFolderPathFromPath(file.path);

            const wasMoved = oldFolderPath !== newFolderPath;

            if (wasMoved) {
                // Create a new ramble file for the new location, preserving the old ramble
                let newRambleFile = this.app.vault.getAbstractFileByPath(newRamblePath) as TFile | null;
                if (!newRambleFile) {
                    // Ensure the subfolders for the new ramble file exist
                    const newRambleFolderPath = this.getRambleFolderPath(newRamblePath);
                    await this.ensureSubfolderExists(newRambleFolderPath);

                    // Create the new ramble file
                    await this.app.vault.create(newRamblePath, '');
                    newRambleFile = this.app.vault.getAbstractFileByPath(newRamblePath) as TFile;
                    this.showNotice(`Created new ramble file: ${newRamblePath}`);
                }

                // Open the new ramble file
                if (newRambleFile) {
                    await this.openRambleFile(newRambleFile);
                }
            } else {
                // If not moved, simply rename the existing ramble file
                const oldRambleFile = this.app.vault.getAbstractFileByPath(oldRamblePath) as TFile | null;
                if (oldRambleFile) {
                    // Rename the ramble file to match the new file name
                    try {
                        await this.app.vault.rename(oldRambleFile, newRamblePath);
                        this.showNotice(`Renamed ramble file to: ${newRamblePath}`);

                        // If the renamed ramble file is currently open, update the reference
                        if (this.currentRambleFile?.path === oldRamblePath) {
                            this.currentRambleFile = this.app.vault.getAbstractFileByPath(
                                newRamblePath
                            ) as TFile;
                        }
                    } catch (error) {
                        this.showNotice(`Failed to rename ramble file to: ${newRamblePath}`);
                        console.error(`Failed to rename ramble file to: ${newRamblePath}`, error);
                    }
                }
            }
        }

        /**
         * Handles renaming or moving of a folder.
         * Updates all ramble files that were under the old folder path.
         * @param folder The folder that was renamed or moved.
         * @param oldPath The old folder path.
         */
        private async handleFolderRename(folder: TFolder, oldPath: string) {
            // Find all ramble files that were under the old folder path
            const ramblesFolderPath = this.settings.ramblesFolderPath;
            const rambleFiles = this.app.vault.getFiles().filter(file =>
                file.path.startsWith(`${ramblesFolderPath}/`)
            );

            for (const rambleFile of rambleFiles) {
                const originalPath = this.getOriginalPathFromRamblePath(rambleFile.path);
                if (originalPath && originalPath.startsWith(oldPath)) {
                    const relativeOriginalPath = originalPath.substring(oldPath.length);
                    const newOriginalPath = `${folder.path}${relativeOriginalPath.startsWith('/') ? '' : '/'}${relativeOriginalPath}`;
                    const newRamblePath = this.getRambleFilePathByOriginalPath(newOriginalPath);

                    try {
                        // Ensure the subfolders for the new ramble file exist
                        const newRambleFolderPath = this.getRambleFolderPath(newRamblePath);
                        await this.ensureSubfolderExists(newRambleFolderPath);

                        await this.app.vault.rename(rambleFile, newRamblePath);
                        this.showNotice(`Updated ramble file path to: ${newRamblePath}`);
                    } catch (error) {
                        this.showNotice(`Failed to update ramble file path to: ${newRamblePath}`);
                        console.error(`Failed to update ramble file path to: ${newRamblePath}`, error);
                    }
                }
            }
        }

        /**
         * Handles file and folder deletion events to rename corresponding ramble files as .notfound.md
         * @param file The file or folder that was deleted.
         */
        private async handleFileOrFolderDelete(file: TFile | TFolder) {
            // Ignore deletions within the rambles folder
            if (file.parent?.path.startsWith(this.settings.ramblesFolderPath)) {
                return;
            }

            if (file instanceof TFolder) {
                // Handle folder deletion: mark all ramble files under this folder as not found
                await this.handleFolderDeletion(file);
            } else if (file instanceof TFile) {
                // Handle file deletion: rename its ramble file to indicate not found
                await this.handleSingleFileDeletion(file);
            }
        }

        /**
         * Handles deletion of a single file by renaming its ramble file to include .notfound.md
         * @param file The file that was deleted.
         */
        private async handleSingleFileDeletion(file: TFile) {
            const rambleFilePath = this.getRambleFilePath(file);
            const rambleFile = this.app.vault.getAbstractFileByPath(rambleFilePath) as TFile | null;
            if (rambleFile && !rambleFile.name.endsWith('.notfound.md')) {
                const notFoundRamblePath = `${rambleFilePath}.notfound.md`;
                try {
                    await this.app.vault.rename(rambleFile, notFoundRamblePath);
                    this.showNotice(`Renamed ramble file to indicate missing original: ${notFoundRamblePath}`);
                } catch (error) {
                    this.showNotice(`Failed to rename ramble file: ${rambleFilePath}`);
                    console.error(`Failed to rename ramble file: ${rambleFilePath}`, error);
                }
            }
        }

        /**
         * Handles deletion of a folder by renaming all associated ramble files to indicate not found.
         * @param folder The folder that was deleted.
         */
        private async handleFolderDeletion(folder: TFolder) {
            const ramblesFolderPath = this.settings.ramblesFolderPath;
            const rambleFiles = this.app.vault.getFiles().filter(file =>
                file.path.startsWith(`${ramblesFolderPath}/`)
            );

            for (const rambleFile of rambleFiles) {
                const originalPath = this.getOriginalPathFromRamblePath(rambleFile.path);
                if (originalPath && originalPath.startsWith(folder.path)) {
                    if (!rambleFile.name.endsWith('.notfound.md')) {
                        const notFoundRamblePath = `${rambleFile.path}.notfound.md`;
                        try {
                            await this.app.vault.rename(rambleFile, notFoundRamblePath);
                            this.showNotice(`Renamed ramble file to indicate missing original: ${notFoundRamblePath}`);
                        } catch (error) {
                            this.showNotice(`Failed to rename ramble file: ${rambleFile.path}`);
                            console.error(`Failed to rename ramble file: ${rambleFile.path}`, error);
                        }
                    }
                }
            }
        }

        /**
         * Constructs the ramble file path based on the original file path.
         * @param originalPath The original file path.
         * @returns The corresponding ramble file path.
         */
        private getRambleFilePathByOriginalPath(originalPath: string): string {
            const fileName = originalPath.split('/').pop() || 'untitled';
            const baseName = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
            const relativePath = this.getRelativePathFromPath(originalPath);
            const format = this.settings.rambleFileFormat;
            const formattedName = format
                .replace('{FILENAME}', baseName)
                .replace('{RELATIVE_PATH}', relativePath);
            return `${this.settings.ramblesFolderPath}/${formattedName}`;
        }

        /**
         * Extracts the relative path from a full file path.
         * @param path The full file path.
         * @returns The relative path without the file name.
         */
        private getRelativePathFromPath(path: string): string {
            const parentFolder = path.split('/').slice(0, -1).join('/');
            if (!parentFolder) return 'root'; // Use 'root' to denote files at the vault's root
            return parentFolder; // Preserve the folder structure
        }

        /**
         * Extracts the original file path from a ramble file path.
         * @param ramblePath The ramble file path.
         * @returns The corresponding original file path or null if extraction fails.
         */
        private getOriginalPathFromRamblePath(ramblePath: string): string | null {
            const format = this.settings.rambleFileFormat;
            const rambleSuffix = '.ramble.md';

            // Ensure the ramble path matches the expected format
            if (!ramblePath.startsWith(`${this.settings.ramblesFolderPath}/`)) {
                return null;
            }

            const relativeRamblePath = ramblePath.substring(this.settings.ramblesFolderPath.length + 1);
            if (!relativeRamblePath.endsWith(rambleSuffix)) {
                return null;
            }

            const formattedName = relativeRamblePath.slice(0, -rambleSuffix.length);
            const [relativePathPart, ...fileParts] = formattedName.split('/');
            const fileNamePart = fileParts.pop();
            if (!fileNamePart) return null;

            const originalFolderPath = relativePathPart === 'root' ? '' : relativePathPart;
            const originalFileName = fileNamePart;

            return originalFolderPath ? `${originalFolderPath}/${originalFileName}.md` : `${originalFileName}.md`;
        }

        /**
         * Gets the folder path from a full file path.
         * @param path The full file path.
         * @returns The folder path without the file name.
         */
        private getFolderPathFromPath(path: string): string {
            const parts = path.split('/');
            parts.pop(); // Remove the file or folder name
            return parts.join('/');
        }

        /**
         * Gets the ramble folder path from a ramble file path.
         * @param ramblePath The ramble file path.
         * @returns The folder path for the ramble file.
         */
        private getRambleFolderPath(ramblePath: string): string {
            const format = this.settings.rambleFileFormat;
            const rambleSuffix = '.ramble.md';

            // Remove ramblesFolderPath
            let relativeRamblePath = ramblePath.substring(this.settings.ramblesFolderPath.length + 1);
            // Remove filename
            const lastSlashIndex = relativeRamblePath.lastIndexOf('/');
            if (lastSlashIndex === -1) {
                return this.settings.ramblesFolderPath;
            }
            return `${this.settings.ramblesFolderPath}/${relativeRamblePath.substring(0, lastSlashIndex)}`;
        }

        /**
         * Extracts the filename from a full path.
         * @param path The full file path.
         * @returns The filename.
         */
        private getFilenameFromPath(path: string): string {
            return path.split('/').pop() || 'untitled.ramble.md';
        }

        /**
         * Reconciles ramble files with existing original files.
         * On plugin load, ensures that ramble files correspond to existing original files.
         * Renames ramble files to indicate not found if originals are missing.
         */
        private async reconcileRambleFiles() {
            const ramblesFolderPath = this.settings.ramblesFolderPath;
            const rambleFiles = this.app.vault.getFiles().filter(file =>
                file.path.startsWith(`${ramblesFolderPath}/`)
            );

            for (const rambleFile of rambleFiles) {
                // Skip already marked not found ramble files
                if (rambleFile.name.endsWith('.notfound.md')) continue;

                const originalPath = this.getOriginalPathFromRamblePath(rambleFile.path);
                if (originalPath) {
                    const originalFile = this.app.vault.getAbstractFileByPath(originalPath) as TFile | null;
                    if (!originalFile) {
                        // Original file does not exist, rename ramble file to indicate missing
                        const notFoundRamblePath = `${rambleFile.path}.notfound.md`;
                        try {
                            await this.app.vault.rename(rambleFile, notFoundRamblePath);
                            this.showNotice(`Renamed ramble file to indicate missing original: ${notFoundRamblePath}`);
                        } catch (error) {
                            this.showNotice(`Failed to rename ramble file: ${rambleFile.path}`);
                            console.error(`Failed to rename ramble file: ${rambleFile.path}`, error);
                        }
                    }
                }
            }
        }

        /**
         * Shows a notice if dev notices are enabled.
         * @param message The message to display.
         */
        private showNotice(message: string) {
            if (this.settings.showDevNotices) {
                new Notice(message);
            }
        }

        /**
         * Renames the rambles folder to a new path and moves all existing ramble files.
         * @param newPath The new folder path.
         */
        public async renameRamblesFolder(newPath: string) {
            const oldPath = this.settings.ramblesFolderPath;
            const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);

            if (!oldFolder || !(oldFolder instanceof TFolder)) {
                this.showNotice(`Old rambles folder not found or is not a folder: ${oldPath}`);
                return;
            }

            // Check if the new folder path already exists
            const existingFolder = this.app.vault.getAbstractFileByPath(newPath);
            if (existingFolder) {
                this.showNotice(`A folder with the path "${newPath}" already exists.`);
                return;
            }

            try {
                await this.app.vault.rename(oldFolder, newPath);
                this.settings.ramblesFolderPath = newPath;
                await this.saveSettings();
                this.showNotice(`Rambles folder renamed to: ${newPath}`);
            } catch (error) {
                console.error('Error renaming rambles folder:', error);
                this.showNotice('Failed to rename rambles folder.');
            }
        }

        /**
         * Renames all existing ramble files according to the new format.
         * @param newFormat The new format string.
         */
        public async renameRambleFiles(newFormat: string) {
            const ramblesFolder = this.app.vault.getAbstractFileByPath(this.settings.ramblesFolderPath);
            if (!ramblesFolder || !(ramblesFolder instanceof TFolder)) {
                this.showNotice(`Rambles folder not found or is not a folder: ${this.settings.ramblesFolderPath}`);
                return;
            }

            const rambleFiles = this.app.vault.getFiles().filter(file =>
                file.path.startsWith(`${this.settings.ramblesFolderPath}/`)
            );

            for (const file of rambleFiles) {
                // Skip already marked not found ramble files
                if (file.name.endsWith('.notfound.md')) continue;

                const originalPath = this.getOriginalPathFromRamblePath(file.path);
                if (!originalPath) {
                    this.showNotice(`Could not determine original file for ramble: ${file.path}. Skipping.`);
                    continue;
                }

                const originalFile = this.app.vault.getAbstractFileByPath(originalPath) as TFile | null;
                if (!originalFile) {
                    this.showNotice(`Original file does not exist for ramble: ${file.path}. Skipping.`);
                    continue;
                }

                const newRamblePath = this.getRambleFilePath(originalFile);

                if (file.path === newRamblePath) {
                    // Filename already matches the new format
                    continue;
                }

                const existingFile = this.app.vault.getAbstractFileByPath(newRamblePath);
                if (existingFile) {
                    this.showNotice(`A ramble file with the path "${newRamblePath}" already exists. Skipping renaming of "${file.path}".`);
                    continue;
                }

                try {
                    // Ensure the subfolders for the new ramble file exist
                    const newRambleFolderPath = this.getRambleFolderPath(newRamblePath);
                    await this.ensureSubfolderExists(newRambleFolderPath);

                    await this.app.vault.rename(file, newRamblePath);
                    this.showNotice(`Renamed ramble file to: ${newRamblePath}`);
                } catch (error) {
                    console.error(`Error renaming ramble file "${file.path}":`, error);
                    this.showNotice(`Failed to rename ramble file "${file.path}".`);
                }
            }

            // Update the format in settings and save
            this.settings.rambleFileFormat = newFormat;
            await this.saveSettings();
        }

        /**
         * Extracts the original filename without the ramble suffix.
         * Assumes the ramble files follow the format defined in rambleFileFormat.
         * @param rambleFilename The ramble file name.
         * @returns The original filename or null if extraction fails.
         */
        private extractOriginalFilename(rambleFilename: string): string | null {
            const format = this.settings.rambleFileFormat;
            // Escape regex special characters except {FILENAME} and {RELATIVE_PATH}
            const escapedFormat = format
                .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
                .replace('\\{FILENAME\\}', '(.*)')
                .replace('\\{RELATIVE_PATH\\}', '(.+)');
            const regex = new RegExp(`^${escapedFormat}$`);
            const match = rambleFilename.match(regex);
            return match ? match[1] : null;
        }
    }

    /**
     * Settings tab for the SimpleRamblesPlugin.
     */
    class SimpleRamblesSettingsTab extends PluginSettingTab {
        plugin: SimpleRamblesPlugin;

        constructor(app: App, plugin: SimpleRamblesPlugin) {
            super(app, plugin);
            this.plugin = plugin;
        }

        display(): void {
            const { containerEl } = this;

            containerEl.empty();

            containerEl.createEl('h2', { text: 'Simple Rambles Settings' });

            // Setting for showing dev notices
            new Setting(containerEl)
                .setName('Show Development Notices')
                .setDesc('Toggle to show or hide development notices.')
                .addToggle(toggle =>
                    toggle
                        .setValue(this.plugin.getSettings().showDevNotices)
                        .onChange(async (value) => {
                            this.plugin.updateSetting('showDevNotices', value);
                            await this.plugin.saveSettings();
                        }));

            // Setting for rambles folder path with a Change button
            new Setting(containerEl)
                .setName('Rambles Folder Path')
                .setDesc('Path to the folder where ramble files are stored. Supports nested folders.')
                .addExtraButton(button => button
                    .onClick(() => {
                        new RenameRamblesFolderInputModal(this.app, this.plugin).open();
                    }));

            // Display current folder path
            containerEl.createEl('div', { cls: 'setting-item-description' })
                .createEl('p', { text: `Current Path: ${this.plugin.getSettings().ramblesFolderPath}` });

            // Setting for ramble file format with a Change button
            new Setting(containerEl)
                .setName('Ramble File Format')
                .setDesc('Define the format for ramble file names. Use {FILENAME} and {RELATIVE_PATH} as placeholders.')
                .addExtraButton(button => button
                    .onClick(() => {
                        new RenameRambleFilesInputModal(this.app, this.plugin).open();
                    }));

            // Display current ramble file format
            containerEl.createEl('div', { cls: 'setting-item-description' })
                .createEl('p', { text: `Current Format: ${this.plugin.getSettings().rambleFileFormat}` });
        }
    }

    /**
     * Modal to handle renaming the rambles folder via input.
     */
    class RenameRamblesFolderInputModal extends Modal {
        plugin: SimpleRamblesPlugin;

        constructor(app: App, plugin: SimpleRamblesPlugin) {
            super(app);
            this.plugin = plugin;
        }

        onOpen() {
            const { contentEl } = this;
            contentEl.createEl('h2', { text: 'Rename Rambles Folder' });

            contentEl.createEl('p', { text: `Enter the new path for the rambles folder:` });

            // Input field for new folder path
            const input = new TextComponent(contentEl);
            input.inputEl.value = this.plugin.getSettings().ramblesFolderPath;
            input.inputEl.placeholder = 'nested/rambles'; // Example of nested path

            // Add buttons
            const buttonContainer = contentEl.createDiv({ cls: 'modal-button-group' });

            new ButtonComponent(buttonContainer)
                .onClick(() => this.close());

            new ButtonComponent(buttonContainer)
                .onClick(async () => {
                    const newFolderPath = input.inputEl.value.trim();
                    if (newFolderPath === '') {
                        new Notice('Rambles folder path cannot be empty.');
                        return;
                    }

                    if (newFolderPath === this.plugin.getSettings().ramblesFolderPath) {
                        new Notice('New folder path is the same as the current one.');
                        this.close();
                        return;
                    }

                    await this.plugin.renameRamblesFolder(newFolderPath);
                    this.close();
                });
        }

        onClose() {
            const { contentEl } = this;
            contentEl.empty();
        }
    }

    /**
     * Modal to handle renaming all existing ramble files according to the new format via input.
     */
    class RenameRambleFilesInputModal extends Modal {
        plugin: SimpleRamblesPlugin;

        constructor(app: App, plugin: SimpleRamblesPlugin) {
            super(app);
            this.plugin = plugin;
        }

        onOpen() {
            const { contentEl } = this;
            contentEl.createEl('h2', { text: 'Rename Ramble Files' });

            contentEl.createEl('p', { text: `Enter the new format for ramble file names:` });

            contentEl.createEl('p', { text: 'Use {FILENAME} and {RELATIVE_PATH} as placeholders.' });

            // Input field for new format
            const input = new TextComponent(contentEl);
            input.inputEl.value = this.plugin.getSettings().rambleFileFormat;
            input.inputEl.placeholder = '{RELATIVE_PATH}/{FILENAME}.ramble.md';

            // Add buttons
            const buttonContainer = contentEl.createDiv({ cls: 'modal-button-group' });

            new ButtonComponent(buttonContainer)
                .onClick(() => this.close());

            new ButtonComponent(buttonContainer)
                .onClick(async () => {
                    const newFormat = input.inputEl.value.trim();
                    if (newFormat === '') {
                        new Notice('Ramble file format cannot be empty.');
                        return;
                    }

                    if (!newFormat.includes('{FILENAME}') || !newFormat.includes('{RELATIVE_PATH}')) {
                        new Notice('Ramble file format must include both {FILENAME} and {RELATIVE_PATH} placeholders.');
                        return;
                    }

                    if (newFormat === this.plugin.getSettings().rambleFileFormat) {
                        new Notice('New ramble file format is the same as the current one.');
                        this.close();
                        return;
                    }

                    await this.plugin.renameRambleFiles(newFormat);
                    this.close();
                });
        }

        onClose() {
            const { contentEl } = this;
            contentEl.empty();
        }
    }
