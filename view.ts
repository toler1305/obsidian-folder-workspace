import { EditableFileView, ItemView, Menu, Notice, TFile, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_EXAMPLE = 'example-view';

export class ExampleView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE_EXAMPLE;
    }

    getDisplayText() {
        return 'Example view';
    }

    async onOpen() {
        new Notice('Example view opened');
        // const container = this.containerEl.children[0];
        // new Notice(JSON.stringify(this.containerEl.children[0].innerHTML));
        // this.containerEl.empty();
        // new Notice(JSON.stringify(this.containerEl.innerHTML));
        // this.containerEl.innerHTML = '<input type="text" id="myInput" value="Hello World">';
        // this.contentEl.innerHTML = '<input type="text" id="myInput" value="Hello World">';

        // new Notice(JSON.stringify(this.containerEl.innerHTML));
        // new Notice(JSON.stringify(this.
        // const mymenu = new Menu();
        // mymenu.addItem((item) => {
        //     item.setTitle('Item 1');
        //     item.setIcon('dice');
        //     item.onClick(() => {
        //         new Notice('Item 1 clicked');
        //     });
        // });
        // this.addChild(mymenu);

        // class MyView extends EditableFileView {
        //     constructor(leaf: WorkspaceLeaf, file: TFile) {
        //         super(leaf);
        //     }

        //     getViewType() {
        //         return 'my-view';
        //     }

        //     getDisplayText() {
        //         return 'My view';
        //     }

        //     async onOpen() {
        //         new Notice('My view opened');
        //     }

        //     async onClose() {
        //         new Notice('My view closed');
        //     }
        // }

        // const newView = new MyView(this.leaf, this.app.vault.getAbstractFileByPath('open-this.md') as TFile);
        // this.leaf.setViewState({ type: 'my-view', active: true });

        // this.leaf.detach();
    }

    async onClose() {
        // Nothing to clean up.
    }
}
