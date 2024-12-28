import { Plugin, TAbstractFile, TFile, FileView, Notice } from 'obsidian';

/**
 * Interface defining the structure of a Ramble.
 */
interface Ramble {
    uid: string;
    filesContext: string[];
    content: string;
}

/**
 * Utility function to generate UUIDs.
 */
function generateUUID(): string {
    // Simple UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = (Math.random() * 16) | 0,
              v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Class responsible for managing data operations, including reading and writing
 * to `rambles-data.md` and `rambles-editor.md`.
 */
class DataManager {
    private readonly dataFilePath = 'rambles-data.md';
    private readonly editorFilePath = 'rambles-editor.md';
    private app: any; // Replace with actual type if available

    constructor(app: any) {
        this.app = app;
    }

    /**
     * Retrieves the data file (`rambles-data.md`) from the vault.
     */
    async getDataFile(): Promise<TFile | null> {
        return this.app.vault.getFileByPath(this.dataFilePath);
    }

    /**
     * Retrieves the editor file (`rambles-editor.md`) from the vault.
     */
    async getEditorFile(): Promise<TFile | null> {
        return this.app.vault.getFileByPath(this.editorFilePath);
    }

    /**
     * Returns the path of the editor file.
     */
    getEditorFilePath(): string {
        return this.editorFilePath;
    }

    /**
     * Returns the path of the data file.
     */
    getDataFilePath(): string {
        return this.dataFilePath;
    }

    /**
     * Reads and parses the JSON data from `rambles-data.md`.
     */
    async readData(): Promise<Ramble[]> {
        const dataFile = await this.getDataFile();
        if (!dataFile) {
            new Notice(`Data file "${this.dataFilePath}" not found.`);
            return [];
        }

        const content = await this.app.vault.cachedRead(dataFile);
        try {
            const rambles: Ramble[] = JSON.parse(content);
            return rambles;
        } catch (error) {
            console.error('Failed to parse JSON data:', error);
            new Notice('Failed to parse rambles data. Please check the JSON format.');
            return [];
        }
    }

    /**
     * Writes the given rambles array as JSON to `rambles-data.md`.
     */
    async writeData(rambles: Ramble[]): Promise<void> {
        const dataFile = await this.getDataFile();
        if (!dataFile) {
            new Notice(`Data file "${this.dataFilePath}" not found.`);
            return;
        }

        const jsonContent = JSON.stringify(rambles, null, 2);
        await this.app.vault.modify(dataFile, jsonContent);
        new Notice('Rambles data updated successfully.');
    }

    /**
     * Reads the content from `rambles-editor.md`.
     */
    async readEditorContent(): Promise<string> {
        const editorFile = await this.getEditorFile();
        if (!editorFile) {
            new Notice(`Editor file "${this.editorFilePath}" not found.`);
            return '';
        }

        return await this.app.vault.cachedRead(editorFile);
    }

    /**
     * Writes the given content to `rambles-editor.md`.
     */
    async writeEditorContent(content: string): Promise<void> {
        const editorFile = await this.getEditorFile();
        if (!editorFile) {
            new Notice(`Editor file "${this.editorFilePath}" not found.`);
            return;
        }

        await this.app.vault.modify(editorFile, content);
        new Notice('Editor content updated successfully.');
    }
}

/**
 * Class responsible for synchronizing data between the editor and the data file.
 */
class EditorSync {
    private dataManager: DataManager;

    constructor(dataManager: DataManager) {
        this.dataManager = dataManager;
    }

    /**
     * Updates the data file (`rambles-data.md`) based on the current content of the editor (`rambles-editor.md`).
     * @param filesContext The context (files) to assign to new rambles.
     */
    async updateDataFromEditor(filesContext: string[]): Promise<void> {
        const editorContent = await this.dataManager.readEditorContent();
        const ramblesFromEditor = this.parseEditorContent(editorContent);

        const existingRambles = await this.dataManager.readData();

        // Filter rambles that belong to currentFilesContext
        const relevantExistingRambles = existingRambles.filter(ramble =>
            ramble.filesContext.some(context => filesContext.includes(context))
        );

        // Map existing rambles by content for quick lookup
        const existingMap = new Map<string, Ramble>();
        relevantExistingRambles.forEach(ramble => {
            existingMap.set(ramble.content, ramble);
        });

        // Prepare updated rambles
        const updatedRambles: Ramble[] = [...existingRambles];

        for (const editorRamble of ramblesFromEditor) {
            const content = editorRamble.content.trim();

            if (existingMap.has(content)) {
                // Existing ramble, retain its UID and filesContext
                const existingRamble = existingMap.get(content)!;
                // Optionally, update content if needed
                existingRamble.content = content;
                existingMap.delete(content);
            } else {
                // New ramble, assign a new UID and current filesContext
                const newRamble: Ramble = {
                    uid: generateUUID(),
                    filesContext: [...filesContext], // clone to prevent mutation
                    content: content,
                };
                updatedRambles.push(newRamble);
            }
        }

        // Rambles remaining in existingMap are deleted in the editor, remove them
        const ramblesToRemove = Array.from(existingMap.values());
        ramblesToRemove.forEach(ramble => {
            const index = updatedRambles.findIndex(r => r.uid === ramble.uid);
            if (index !== -1) {
                updatedRambles.splice(index, 1);
            }
        });

        await this.dataManager.writeData(updatedRambles);
    }

    /**
     * Updates the editor (`rambles-editor.md`) based on the current data in the data file (`rambles-data.md`).
     * Only includes rambles tagged with one of the current filesContext.
     */
    async updateEditor(currentFilesContext: string[]): Promise<void> {
        const allRambles = await this.dataManager.readData();

        // Filter rambles based on currentFilesContext
        const filteredRambles = allRambles.filter(ramble =>
            ramble.filesContext.some(context => currentFilesContext.includes(context))
        );

        const editorContent = this.generateEditorContent(filteredRambles);
        await this.dataManager.writeEditorContent(editorContent);
    }

    /**
     * Parses the editor content into an array of ramble objects containing content.
     * Ensures that each ramble is separated by a separator line with three or more dashes.
     * Trims the first and last empty lines from each ramble.
     */
    private parseEditorContent(content: string): { content: string }[] {
        // Split by separator with three or more dashes surrounded by optional whitespace
        const ramblesRaw = content.split(/\n\s*---+\s*\n/).map(ramble => ramble.trim()).filter(ramble => ramble.length > 0);

        const rambles: { content: string }[] = [];

        ramblesRaw.forEach(ramble => {
            rambles.push({ content: ramble });
        });

        return rambles;
    }

    /**
     * Generates the editor content by joining rambles with a separator.
     * Each ramble is displayed without numbering.
     * Trims the first and last empty lines from each ramble.
     */
    private generateEditorContent(rambles: Ramble[]): string {
        return rambles.map(ramble => ramble.content.trim()).join('\n\n---\n\n');
    }
}

/**
 * Main Plugin Class
 */
export default class ExamplePlugin extends Plugin {
    private dataManager!: DataManager;
    private editorSync!: EditorSync;
    private currentFilesContext: string[] = [];
    private isUpdatingEditor: boolean = false;

    async onload() {
        console.log('ExamplePlugin loaded');

        // Initialize DataManager and EditorSync
        this.dataManager = new DataManager(this.app);
        this.editorSync = new EditorSync(this.dataManager);

        // Register Event Listeners
        this.registerEvent(this.app.workspace.on('layout-change', this.handleLayoutChange.bind(this)));
        this.registerEvent(this.app.vault.on('modify', this.handleFileModify.bind(this)));

        // Initialize currentFilesContext by handling the initial layout
        await this.handleLayoutChange();
    }

    async onunload() {
        console.log('ExamplePlugin unloaded');
    }

    /**
     * Handles file modifications within the vault.
     * Specifically listens for changes to `rambles-editor.md` to update the data file.
     */
    private async handleFileModify(file: TAbstractFile): Promise<void> {
        if (file.path !== this.dataManager.getEditorFilePath()) return;
        if (this.isUpdatingEditor) return; // prevent recursive updates
        await this.editorSync.updateDataFromEditor(this.currentFilesContext);
    }

    /**
     * Handles layout changes in the workspace.
     * Updates the editor based on the current active markdown files, excluding plugin-related files.
     * Also filters the rambles to show only those tagged with currently open files.
     */
    private async handleLayoutChange(): Promise<void> {
        const activeMarkdownLeaves = this.app.workspace.getLeavesOfType('markdown');
        const filePaths = activeMarkdownLeaves
            .map(leaf => (leaf.view as FileView).file?.path)
            .filter((path): path is string => typeof path === 'string');
        const nonPluginFilePaths = filePaths.filter(path => !path.includes('rambles'));

        this.currentFilesContext = nonPluginFilePaths;

        this.isUpdatingEditor = true;
        await this.editorSync.updateEditor(this.currentFilesContext);
        this.isUpdatingEditor = false;
    }
}
