const { Plugin, ItemView, MarkdownView, setIcon } = require('obsidian');

const VIEW_TYPE = 'fountain-navigator-view';

class FountainNavigatorView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.scenes = [];
        this.currentFile = null;
        this.lastActiveLeaf = null;
        this.isUpdating = false;
        this.isDragging = false;
        this.savedScrollPosition = null;
        this.scrollContainer = null;
        this.mouseDownTime = 0;
        // Toggle states - default: Preview ON, rest OFF
        this.showCharacters = false;
        this.showPreview = true;
        this.showSceneNumbers = false;
        this.showTasks = false;
    }

    getViewType() {
        return VIEW_TYPE;
    }

    getDisplayText() {
        return 'Fountain Navigator';
    }

    getIcon() {
        return 'list';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('fountain-navigator-container');
        
        // Make container focusable so it can receive immediate clicks
        container.setAttribute('tabindex', '-1');

        // Add toggle buttons header
        const headerEl = container.createDiv({ cls: 'fountain-nav-header' });
        
        // Button order: Preview text, Scene numbers, Characters, Tasks
        const togglePreview = headerEl.createEl('button', {
            cls: 'fountain-nav-toggle',
            attr: { 'aria-label': 'Toggle Preview Text' }
        });
        setIcon(togglePreview, 'align-center');
        togglePreview.addEventListener('click', () => {
            this.showPreview = !this.showPreview;
            togglePreview.toggleClass('is-active', this.showPreview);
            // Toggle class on container
            this.navContainer.toggleClass('hide-preview', !this.showPreview);
        });
        togglePreview.toggleClass('is-active', this.showPreview);
        
        const toggleSceneNumbers = headerEl.createEl('button', {
            cls: 'fountain-nav-toggle',
            attr: { 'aria-label': 'Toggle Scene Numbers' }
        });
        setIcon(toggleSceneNumbers, 'list-ordered');
        toggleSceneNumbers.addEventListener('click', () => {
            this.showSceneNumbers = !this.showSceneNumbers;
            toggleSceneNumbers.toggleClass('is-active', this.showSceneNumbers);
            // Toggle class on container
            this.navContainer.toggleClass('hide-scene-numbers', !this.showSceneNumbers);
        });
        toggleSceneNumbers.toggleClass('is-active', this.showSceneNumbers);
        
        const toggleCharacters = headerEl.createEl('button', {
            cls: 'fountain-nav-toggle',
            attr: { 'aria-label': 'Toggle Characters' }
        });
        setIcon(toggleCharacters, 'users-round');
        toggleCharacters.addEventListener('click', () => {
            this.showCharacters = !this.showCharacters;
            toggleCharacters.toggleClass('is-active', this.showCharacters);
            // Toggle class on container
            this.navContainer.toggleClass('hide-characters', !this.showCharacters);
        });
        toggleCharacters.toggleClass('is-active', this.showCharacters);

        const toggleTasks = headerEl.createEl('button', {
            cls: 'fountain-nav-toggle',
            attr: { 'aria-label': 'Toggle Tasks' }
        });
        setIcon(toggleTasks, 'circle-check-big');
        toggleTasks.addEventListener('click', () => {
            this.showTasks = !this.showTasks;
            toggleTasks.toggleClass('is-active', this.showTasks);
            // Toggle class on container
            this.navContainer.toggleClass('hide-tasks', !this.showTasks);
        });
        toggleTasks.toggleClass('is-active', this.showTasks);

        this.navContainer = container.createDiv({ cls: 'fountain-nav-content' });
        this.scrollContainer = this.navContainer;
        
        // Set initial toggle states on container
        this.navContainer.toggleClass('hide-characters', !this.showCharacters);
        this.navContainer.toggleClass('hide-preview', !this.showPreview);
        this.navContainer.toggleClass('hide-scene-numbers', !this.showSceneNumbers);
        this.navContainer.toggleClass('hide-tasks', !this.showTasks);
        
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    this.lastActiveLeaf = leaf;
                }
                this.update();
            })
        );
        
        this.registerEvent(
            this.app.workspace.on('file-open', () => this.update())
        );
        
        this.registerEvent(
            this.app.metadataCache.on('changed', () => this.update())
        );

        this.update();
    }

    getActiveMarkdownView() {
        if (this.lastActiveLeaf && this.lastActiveLeaf.view instanceof MarkdownView) {
            return this.lastActiveLeaf.view;
        }
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            return activeView;
        }

        const leaves = this.app.workspace.getLeavesOfType('markdown');
        if (leaves.length > 0 && leaves[0].view instanceof MarkdownView) {
            return leaves[0].view;
        }

        return null;
    }

    async update() {
        if (this.isUpdating) return;
        this.isUpdating = true;

        // Capture scroll position before any changes
        let scrollToRestore;
        if (this.savedScrollPosition !== null) {
            scrollToRestore = this.savedScrollPosition;
            this.savedScrollPosition = null;
        } else if (this.scrollContainer) {
            scrollToRestore = this.scrollContainer.scrollTop;
        } else {
            scrollToRestore = 0;
        }

        const view = this.getActiveMarkdownView();
        
        if (!view || !view.file) {
            this.navContainer.empty();
            this.navContainer.createDiv({ 
                text: 'No active markdown file', 
                cls: 'fountain-nav-empty' 
            });
            this.isUpdating = false;
            return;
        }

        // Check if file changed
        const fileChanged = this.currentFile?.path !== view.file.path;
        this.currentFile = view.file;

        const cache = this.app.metadataCache.getFileCache(view.file);
        const isFountain = cache?.frontmatter?.cssclasses?.includes('fountain');
        
        if (!isFountain) {
            this.navContainer.empty();
            this.navContainer.createDiv({ 
                text: 'Add "cssclasses: fountain" to frontmatter', 
                cls: 'fountain-nav-empty' 
            });
            this.isUpdating = false;
            return;
        }

        const content = await this.app.vault.read(view.file);
        const newScenes = this.parseFountain(content);
        
        if (newScenes.length === 0) {
            this.navContainer.empty();
            this.navContainer.createDiv({ 
                text: 'No scenes found', 
                cls: 'fountain-nav-empty' 
            });
            this.isUpdating = false;
            return;
        }

        // Check if scenes actually changed
        const scenesChanged = fileChanged || 
            this.scenes.length !== newScenes.length ||
            this.scenes.some((scene, i) => 
                scene.type !== newScenes[i]?.type || 
                scene.text !== newScenes[i]?.text ||
                scene.line !== newScenes[i]?.line
            );

        // Only re-render if something changed
        if (scenesChanged) {
            this.scenes = newScenes;
            this.navContainer.empty();
            this.renderScenes();
        }
        
        // Always restore scroll position
        if (this.scrollContainer) {
            requestAnimationFrame(() => {
                if (this.scrollContainer) {
                    this.scrollContainer.scrollTop = scrollToRestore;
                }
            });
        }
        
        this.isUpdating = false;
    }

    parseFountain(content) {
        const lines = content.split('\n');
        const items = [];
        let inFrontmatter = false;

        lines.forEach((line, index) => {
            if (line.trim() === '---') {
                inFrontmatter = !inFrontmatter;
                return;
            }
            if (inFrontmatter) return;

            const sectionMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (sectionMatch) {
                items.push({
                    type: 'section',
                    level: sectionMatch[1].length,
                    text: sectionMatch[2],
                    line: index
                });
                return;
            }

            if (line.match(/^(INT|EXT|INT\.\/EXT|I\/E)[\.\s]/i) || line.match(/^\.[A-Z]/)) {
                let text = line;
                if (text.startsWith('.')) text = text.substring(1);
                
                items.push({
                    type: 'scene',
                    text: text.trim(),
                    line: index
                });
                return;
            }

            const synopsisMatch = line.match(/^=\s*(.+)$/);
            if (synopsisMatch) {
                items.push({
                    type: 'synopsis',
                    text: synopsisMatch[1],
                    line: index
                });
                return;
            }

            const noteMatch = line.match(/^\[\[(.+?)\]\]$/);
            if (noteMatch) {
                items.push({
                    type: 'note',
                    text: noteMatch[1],
                    line: index
                });
            }
        });

        return items;
    }

    extractScenePreview(lines, startLine, endLine) {
        const previewLines = [];
        let lineCount = 0;
        
        for (let i = startLine + 1; i <= endLine && lineCount < 3; i++) {
            const line = lines[i];
            if (!line) continue;
            
            if (line.trim() === '') continue;
            
            if (line.match(/^(INT|EXT|INT\.\/EXT|I\/E)[\.\s]/i)) continue;
            if (line.match(/^\.[A-Z]/)) continue;
            if (line.match(/^=\s*(.+)$/)) continue;
            if (line.match(/^\[\[(.+?)\]\]$/)) continue;
            if (line.match(/^#{1,6}\s+/)) continue;
            if (line.match(/^- \[[ xX]\]/)) continue; // Skip task lines in preview
            
            if (line.match(/^[A-Z\s]+TO:$/)) continue;
            
            previewLines.push(line.trim());
            lineCount++;
        }
        
        return previewLines.join(' ').substring(0, 200);
    }

    extractCharacters(lines, startLine, endLine) {
        const characters = new Set();
        
        for (let i = startLine + 1; i <= endLine; i++) {
            const line = lines[i];
            if (!line) continue;
            
            const prevLine = i > 0 ? lines[i - 1] : '';
            const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
            
            if (prevLine.trim() === '' && line.match(/^[A-Z][A-Z\s]+(\s*\(.*\))?$/)) {
                if (nextLine && (nextLine.match(/^\(.*\)$/) || !nextLine.match(/^[A-Z\s]+$/))) {
                    let charName = line.trim();
                    charName = charName.replace(/\s*\(.*\)$/, '');
                    if (charName.length > 0 && charName.length < 30) {
                        charName = charName.charAt(0).toUpperCase() + charName.slice(1).toLowerCase();
                        characters.add(charName);
                    }
                }
            }
        }
        
        return Array.from(characters);
    }

    extractTasks(lines, startLine, endLine) {
        const tasks = [];
        
        for (let i = startLine + 1; i <= endLine; i++) {
            const line = lines[i];
            if (!line) continue;
            
            // Match both unchecked and checked tasks
            const taskMatch = line.match(/^- \[([ xX])\]\s*(.+)$/);
            if (taskMatch) {
                const checked = taskMatch[1] !== ' ';
                const taskText = taskMatch[2].trim();
                tasks.push({
                    checked: checked,
                    text: taskText,
                    line: i  // Store the line number for navigation
                });
            }
        }
        
        return tasks;
    }

    renderScenes() {
        const list = this.navContainer.createEl('div', { cls: 'fountain-nav-list' });
        const view = this.getActiveMarkdownView();
        if (!view) return;
        
        const content = view.data;
        const lines = content.split('\n');
        
        // Count scene numbers
        let sceneNumber = 0;
        
        this.scenes.forEach((scene, index) => {
            const item = list.createDiv({ cls: `fountain-nav-item fountain-${scene.type}` });
            
            if (scene.type === 'section') {
                item.style.paddingLeft = `${(scene.level - 1) * 12}px`;
            }

            const content = item.createDiv({ cls: 'fountain-nav-item-content' });
            
            const heading = content.createDiv({ cls: 'fountain-nav-heading' });
            
            // Always render scene number (CSS will control visibility)
            if (scene.type === 'scene') {
                sceneNumber++;
                const sceneNumSpan = heading.createEl('span', { cls: 'fountain-scene-number' });
                sceneNumSpan.textContent = `${sceneNumber}. `;
            }
            
            const headingText = heading.createEl('span', { cls: 'fountain-heading-text' });
            headingText.textContent = scene.text;

            if (scene.type === 'scene') {
                const sceneEnd = this.getSceneEnd(index);
                
                // Extract tasks
                const tasks = this.extractTasks(lines, scene.line, sceneEnd);
                
                // Always render task indicator icon if scene has tasks (CSS will control visibility)
                if (tasks.length > 0) {
                    const taskIconContainer = heading.createEl('span', { cls: 'fountain-task-indicator' });
                    setIcon(taskIconContainer, 'sticky-note');
                }
                
                // Always render preview text (CSS will control visibility)
                const preview = this.extractScenePreview(lines, scene.line, sceneEnd);
                const previewDiv = content.createDiv({ cls: 'fountain-nav-preview' });
                if (preview) {
                    previewDiv.textContent = preview;
                } else {
                    previewDiv.textContent = '';
                }
                
                // Always render characters (CSS will control visibility)
                const characters = this.extractCharacters(lines, scene.line, sceneEnd);
                const charsDiv = content.createDiv({ cls: 'fountain-nav-characters' });
                if (characters.length > 0) {
                    const label = charsDiv.createEl('span', { cls: 'fountain-nav-characters-label' });
                    label.textContent = 'Characters: ';
                    const charList = charsDiv.createEl('span');
                    charList.textContent = characters.join(', ');
                }

                // Always render tasks (CSS will control visibility)
                const tasksDiv = content.createDiv({ cls: 'fountain-nav-tasks' });
                if (tasks.length > 0) {
                    const taskList = tasksDiv.createEl('div', { cls: 'fountain-task-list' });
                    tasks.forEach(task => {
                        const taskItem = taskList.createEl('div', { cls: 'fountain-task-item' });
                        const checkbox = taskItem.createEl('span', { cls: 'fountain-task-checkbox' });
                        checkbox.textContent = task.checked ? '☑' : '☐';
                        const taskTextEl = taskItem.createEl('span', { cls: 'fountain-task-text' });
                        taskTextEl.textContent = task.text;
                        if (task.checked) {
                            taskItem.addClass('fountain-task-checked');
                        }

                        // Make task clickable - navigate to the task line
                        taskItem.style.cursor = 'pointer';
                        taskItem.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation(); // Prevent scene click from firing
                            
                            // Save scroll position before navigation
                            if (this.scrollContainer) {
                                this.savedScrollPosition = this.scrollContainer.scrollTop;
                            }
                            
                            // Navigate to the task's line
                            await this.jumpToLineWithoutFocus(task.line);
                        });
                    });
                }
            }

            if (scene.type === 'scene') {
                item.draggable = true;
                item.dataset.index = index.toString();
                
                item.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    // Save scroll position at the start of drag
                    if (this.scrollContainer) {
                        this.savedScrollPosition = this.scrollContainer.scrollTop;
                    }
                    this.isDragging = true;
                    item.addClass('fountain-dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', index.toString());
                });

                item.addEventListener('dragend', (e) => {
                    e.stopPropagation();
                    item.removeClass('fountain-dragging');
                    list.querySelectorAll('.fountain-drop-before, .fountain-drop-after').forEach(el => {
                        el.removeClass('fountain-drop-before');
                        el.removeClass('fountain-drop-after');
                    });
                    // Reset drag state after a short delay
                    setTimeout(() => {
                        this.isDragging = false;
                    }, 100);
                });

                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const dragging = list.querySelector('.fountain-dragging');
                    if (!dragging || item.hasClass('fountain-dragging')) return;

                    list.querySelectorAll('.fountain-drop-before, .fountain-drop-after').forEach(el => {
                        el.removeClass('fountain-drop-before');
                        el.removeClass('fountain-drop-after');
                    });

                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    if (e.clientY < midpoint) {
                        item.addClass('fountain-drop-before');
                    } else {
                        item.addClass('fountain-drop-after');
                    }
                });

                item.addEventListener('dragleave', (e) => {
                    e.stopPropagation();
                    item.removeClass('fountain-drop-before');
                    item.removeClass('fountain-drop-after');
                });

                item.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    item.removeClass('fountain-drop-before');
                    item.removeClass('fountain-drop-after');
                    
                    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                    const toIndex = parseInt(item.dataset.index);
                    
                    const rect = item.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    const position = e.clientY < midpoint ? 'before' : 'after';
                    
                    if (fromIndex !== toIndex) {
                        // savedScrollPosition is already set from dragstart
                        await this.moveScene(fromIndex, toIndex, position);
                        // update() will be called automatically and will use savedScrollPosition
                    }
                });
            }

            // Use mousedown for immediate response without requiring focus first
            item.addEventListener('mousedown', async (e) => {
                // Only handle left click
                if (e.button !== 0) return;
                
                // Track mousedown time
                this.mouseDownTime = Date.now();
            });
            
            item.addEventListener('mouseup', async (e) => {
                // Only handle left click
                if (e.button !== 0) return;
                
                // Only navigate if not dragging and mouseup happened quickly after mousedown
                // (to distinguish from drag operations)
                const timeSinceMouseDown = Date.now() - this.mouseDownTime;
                if (this.isDragging || timeSinceMouseDown > 200) {
                    return;
                }
                
                e.preventDefault();
                e.stopPropagation();
                
                // Save scroll position before any action
                if (this.scrollContainer) {
                    this.savedScrollPosition = this.scrollContainer.scrollTop;
                }
                
                // Navigate to the line
                await this.jumpToLineWithoutFocus(scene.line);
            });
        });
    }

    getSceneEnd(sceneIndex) {
        for (let i = sceneIndex + 1; i < this.scenes.length; i++) {
            if (this.scenes[i].type === 'scene') {
                return this.scenes[i].line - 1;
            }
        }
        const view = this.getActiveMarkdownView();
        if (view) {
            return view.data.split('\n').length - 1;
        }
        return this.scenes[sceneIndex].line + 50;
    }

    async moveScene(fromIndex, toIndex, position) {
        const view = this.getActiveMarkdownView();
        if (!view || !view.file) return;
        
        const targetLeaf = this.lastActiveLeaf;
        
        const content = await this.app.vault.read(view.file);
        const lines = content.split('\n');

        const fromScene = this.scenes[fromIndex];
        
        const fromStart = fromScene.line;
        let fromEnd = lines.length - 1;
        
        for (let i = fromIndex + 1; i < this.scenes.length; i++) {
            if (this.scenes[i].type === 'scene') {
                fromEnd = this.scenes[i].line - 1;
                break;
            }
        }

        const sceneLines = lines.slice(fromStart, fromEnd + 1);
        
        lines.splice(fromStart, fromEnd - fromStart + 1);

        const toScene = this.scenes[toIndex];
        let insertLine = toScene.line;
        
        if (fromStart < insertLine) {
            insertLine -= (fromEnd - fromStart + 1);
        }

        if (position === 'after') {
            let sceneEnd = lines.length;
            for (let i = toIndex + 1; i < this.scenes.length; i++) {
                if (this.scenes[i].type === 'scene') {
                    sceneEnd = this.scenes[i].line;
                    if (fromStart < sceneEnd) {
                        sceneEnd -= (fromEnd - fromStart + 1);
                    }
                    break;
                }
            }
            insertLine = sceneEnd;
        }

        lines.splice(insertLine, 0, ...sceneLines);

        await this.app.vault.modify(view.file, lines.join('\n'));
        
        if (targetLeaf) {
            this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
        }
    }

    async jumpToLineWithoutFocus(line) {
        const view = this.getActiveMarkdownView();
        if (!view || !view.file) return;

        const pos = { line: line, ch: 0 };
        const state = { 
            line: line,
            cursor: { from: pos, to: pos }
        };
        
        // Just scroll to the line without changing focus
        view.setEphemeralState(state);
    }

    async jumpToLineWhenClick(line) {
        const view = this.getActiveMarkdownView();
        if (!view || !view.file) return;

        const pos = { line: line, ch: 0 };
        const state = { 
            line: line,
            cursor: { from: pos, to: pos }
        };
        
        view.setEphemeralState(state);
        
        if (this.lastActiveLeaf) {
            this.app.workspace.setActiveLeaf(this.lastActiveLeaf, { focus: true });
        }
        
        setTimeout(() => {
            view.editor.focus();
        }, 10);
    }
}

class FountainNavigatorPlugin extends Plugin {
    async onload() {
        this.registerView(
            VIEW_TYPE,
            (leaf) => new FountainNavigatorView(leaf, this)
        );

        this.addRibbonIcon('list', 'Open Fountain Navigator', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-fountain-navigator',
            name: 'Open Fountain Navigator',
            callback: () => {
                this.activateView();
            }
        });
    }

    async activateView() {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                await rightLeaf.setViewState({
                    type: VIEW_TYPE,
                    active: true,
                });
                leaf = rightLeaf;
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    onunload() {}
}

module.exports = FountainNavigatorPlugin;