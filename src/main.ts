
import {
	App,                  // Obsidian 应用实例，可访问 vault、workspace、插件管理器等全局对象
	arrayBufferToBase64,  // 工具函数，将 ArrayBuffer 转为 Base64，常用于图片或二进制数据处理
	Component,            // UI 组件基类，可管理事件生命周期等
	FileSystemAdapter,    // 文件系统适配器，用于读写本地或远程文件
	MarkdownRenderer,     // Markdown 渲染器，将 Markdown 内容渲染为 HTML
	MarkdownView,         // Markdown 窗口视图，表示当前打开的编辑器
	Modal,                // 弹窗类，用于创建自定义模态窗口
	Notice,               // 系统通知类，在屏幕右下角显示提示信息
	Plugin,               // 插件基类，所有 Obsidian 插件必须继承它
	TAbstractFile,        // 抽象文件类，代表文件系统中的任意文件或文件夹
	TFile                 // 文件类，继承自 TAbstractFile，表示具体文件（如 Markdown 文件）
} from 'obsidian';

import {DEFAULT_SETTINGS, CopyDocument2MpSettings, CopyDocument2MpSettingsTab, StyleSheetStyle} from "./settings";
// 导入样式配置
import { STYLES } from './styles_temp.js';


/*
 * 全局变量 - 这些变量用于跟踪复制过程和 Markdown 渲染状态，以确保在适当的时间执行复制操作，并避免冲突
 * 1. copyIsRunning：防止多个复制操作同时进行
 * 2. ppIsProcessing：跟踪 Markdown 后处理器是否正在处理块
 * 3. ppLastBlockDate：记录最后一个块完成处理的时间，用于判断渲染是否完成
 */
let copyIsRunning = false;
let ppIsProcessing = false;
let ppLastBlockDate = Date.now();

const DEFAULT_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>\${title}</title>
  <style>
    \${MERMAID_STYLESHEET}
    \${stylesheet}
  </style>
</head>
<body>
\${body}
</body>
</html>
`;

function allWithProgress(promises: Promise<never>[], callback: (percentCompleted: number) => void) {
	let count = 0;
	callback(0);
	for (const promise of promises) {
		// Add both .then and .catch handlers to handle rejections
		promise.then(() => {
			count++;
			callback((count * 100) / promises.length);
		}).catch(() => {
			// Handle rejection by still counting it as completed
			count++;
			callback((count * 100) / promises.length);
			// Re-throw or handle as needed based on your requirements
		});
	}
	return Promise.all(promises);
}


/**
 * 延迟一段时间
 */
async function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}


export default class CopyDocument2MpPlugin extends Plugin {
	settings: CopyDocument2MpSettings;

	/**
	 * 插件加载时的初始化方法
	 * 1. 加载设置
	 * 2. 注册三个复制命令
	 * 3. 注册 Markdown 后处理器来跟踪渲染进度
	 * 4. 添加设置标签页
	 * 5. 设置编辑器菜单项
	 */
	async onload() {
		await this.loadSettings();

		// 注册智能复制命令：根据是否有选择内容决定复制整个文档还是选择部分
		this.addCommand({
			id: 'smart-copy-to-mp',
			name: '复制选择或文档到剪贴板',
			checkCallback: (checking: boolean): boolean => {
				if (copyIsRunning) {
					return false;
				}
		
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView) {
					return false;
				}
		
				if (!checking) {
					// 如果有选择内容，复制选择；否则复制整个文档
					// eslint-disable-next-line @typescript-eslint/no-floating-promises
					this.copyFromView(activeView, activeView.editor.somethingSelected());
				}
		
				return true;
			}
		})
		
		// 注册后处理器来跟踪块渲染进度。详细解释见 DocumentRenderer#untilRendered()
		// 这些后处理器用于检测 Markdown 渲染何时完成
		const beforeAllPostProcessor = this.registerMarkdownPostProcessor(async () => {
			ppIsProcessing = true; // 标记正在处理中
		});
		beforeAllPostProcessor.sortOrder = -10000; // 高优先级，最先执行

		const afterAllPostProcessor = this.registerMarkdownPostProcessor(async () => {
			ppLastBlockDate = Date.now(); // 更新最后处理时间
			ppIsProcessing = false; // 标记处理完成
		});
		afterAllPostProcessor.sortOrder = 10000; // 低优先级，最后执行

		// 注册 UI 元素
		this.addSettingTab(new CopyDocument2MpSettingsTab(this.app, this));
		this.setupEditorMenuEntry();

	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<CopyDocument2MpSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * 构建命令检查回调函数
	 * Obsidian 命令系统使用此函数来检查命令是否可用
	 * @param action 实际执行的操作函数
	 * @returns 返回一个检查回调函数
	 */
	private buildCheckCallback(action: (activeView: MarkdownView) => void) {
		return (checking: boolean): boolean => {
			// 检查是否已经有复制操作在进行中
			if (copyIsRunning) {
				return false;
			}

			// 获取当前活动的 Markdown 视图
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) {
				return false;
			}

			// 如果 checking 为 true，表示只是检查命令是否可用
			// 如果 checking 为 false，表示实际执行命令
			if (!checking) {
				action(activeView);
			}

			return true;
		}
	}
	/**
	 * 从当前活动视图复制内容
	 * @param activeView 当前活动的 Markdown 视图
	 * @param onlySelected 是否只复制选中的内容（true=只复制选中内容，false=复制整个文档）
	 */
	private copyFromView(activeView: MarkdownView, onlySelected: boolean) {
		if (!activeView.editor) {
			console.error('No editor in active view, nothing to copy');
			return;
		}

		if (!activeView.file) {
			// 如果视图中有编辑器，通常应该有文件，但这里做安全检查
			console.error('No file in active view, nothing to copy');
			return;
		}

		// 根据 onlySelected 参数决定复制选中内容还是整个文档
		const markdown = onlySelected ? activeView.editor.getSelection() : activeView.data;

		const path = activeView.file.path;
		const name = activeView.file.name;
		// 调用实际复制方法，isFullDocument = !onlySelected
		return this.doCopy(markdown, path, name, !onlySelected);
	}

	/**
	 * 实际执行复制操作的核心方法
	 * @param markdown Markdown 内容
	 * @param path 文件路径
	 * @param name 文件名
	 * @param isFullDocument 是否是完整文档（true=完整文档，false=部分内容）
	 * @param style 样式表lemondeth
	 */
	private async doCopy(markdown: string, path: string, name: string, isFullDocument: boolean) {
		console.debug(`Copying "${path}" to clipboard...`);
		const title = name.replace(/\.md$/i, ''); // 移除 .md 扩展名作为标题

		// 创建文档渲染器，传入当前应用实例和设置
		const copier = new DocumentRenderer(this.app, this.settings);

		try {
			copyIsRunning = true; // 标记复制操作正在进行

			// 重置后处理器状态
			ppLastBlockDate = Date.now();
			ppIsProcessing = true;

			// 渲染 Markdown 为 HTML
			const htmlBody = await copier.renderDocument(markdown, path);

			// 如果设置中要求添加文件名作为标题，并且是完整文档
			if (this.settings.fileNameAsHeader && isFullDocument) {
				const h1 = htmlBody.createEl('h1');
				h1.textContent = title;
				htmlBody.insertBefore(h1, htmlBody.firstChild);
			}

			// 根据设置决定生成完整的 HTML 文档还是仅 HTML 片段
			// 优先使用 const，只有在需要重新赋值时才使用 let
			let htmlDocument = this.settings.bareHtmlOnly
				? htmlBody.outerHTML  // 仅 HTML 片段
				: this.expandHtmlTemplate(htmlBody.outerHTML, title); // 完整的 HTML 文档

			// 简化代码块格式
			htmlDocument = this.simplifyCodeBlocks(htmlDocument);

			// 处理列表项格式
			htmlDocument = this.preprocessMarkdownList(htmlDocument);

			// 应用内联样式
			htmlDocument = this.applyInlineStyles(htmlDocument, this.settings.styleSheetStyle);

			// 创建剪贴板项，同时包含 HTML 和纯文本格式
			const data =
				new ClipboardItem({
					"text/html": new Blob([htmlDocument], {
						// @ts-ignore
						type: ["text/html", 'text/plain']
					}),
					"text/plain": new Blob([htmlDocument], {
						type: "text/plain"
					}),
				});

			// 写入剪贴板
			await navigator.clipboard.write([data]);
			new Notice(`复制成功！`);
		} catch (error) {
			new Notice(`copy failed: ${error instanceof Error ? error.message : String(error)}`);
			console.error('复制失败', error);
		} finally {
			copyIsRunning = false; // 无论成功失败，都标记复制操作结束
		}
	}

	/** 代码块简化 */
	private simplifyCodeBlocks(htmlString: string): string {

		// 创建临时DOM元素来处理HTML字符串
		const tempDiv = document.createElement('div');
		const parser = new DOMParser();
		const doc = parser.parseFromString(htmlString, 'text/html');
		tempDiv.replaceChildren(...Array.from(doc.body.children));

		// 查询所有具有特定样式的 pre 标签，且包含 code 元素
		const codeBlocks = tempDiv.querySelectorAll('pre:has(> code)');
		// 遍历每个找到的代码块元素
		codeBlocks.forEach(block => {
			const codeElement = block.querySelector('code');
			if (codeElement) {
				const codeText = codeElement.innerHTML || codeElement.innerText;
				const pre = document.createElement('pre');
				const code = document.createElement('code');

				pre.setAttribute('style',
					'background: linear-gradient(to bottom, #2a2c33 0%, #383a42 8px, #383a42 100%);' +
					'padding: 0;' +
					'border-radius: 6px;' +
					'overflow: hidden;' +
					'margin: 24px 0;' +
					'box-shadow: 0 2px 8px rgba(0,0,0,0.15);'
				);

				code.setAttribute('style',
					'color: #abb2bf;' +
					'font-family: "SF Mono", Consolas, Monaco, "Courier New", monospace;' +
					'font-size: 14px;' +
					'line-height: 1.7;' +
					'display: block;' +
					'white-space: pre;' +
					'padding: 16px 20px;' +
					'-webkit-font-smoothing: antialiased;' +
					'-moz-osx-font-smoothing: grayscale;'
				);

				// 安全地设置代码内容，保留格式化元素
				const fragment = document.createRange().createContextualFragment(codeText);
				code.replaceChildren(...Array.from(fragment.childNodes));
				pre.appendChild(code);
				block.parentNode!.replaceChild(pre, block);
			}
		});

		// 返回处理后的HTML字符串
		return tempDiv.innerHTML;
	}

	private preprocessMarkdownList(content: string) {
		// 规范化列表项格式，将冒号分隔的文本、换行的续行文本合并到同一行
		content = content.replace(/^(\s*(?:\d+\.|-|\*)\s+[^:\n]+)\n\s*:\s*(.+?)$/gm, '$1: $2');
		content = content.replace(/^(\s*(?:\d+\.|-|\*)\s+.+?:)\s*\n\s+(.+?)$/gm, '$1 $2');
		content = content.replace(/^(\s*(?:\d+\.|-|\*)\s+[^:\n]+)\n:\s*(.+?)$/gm, '$1: $2');
		content = content.replace(/^(\s*(?:\d+\.|-|\*)\s+.+?)\n\n\s+(.+?)$/gm, '$1 $2');
		return content;
	}

	// 应用内联样式 ++++++
	private applyInlineStyles(html: string, applyStyle: StyleSheetStyle) {
		const styleKey = applyStyle as keyof typeof STYLES;
		const styleObj = STYLES[styleKey];
		if (!styleObj) {
			console.warn(`样式 ${styleKey} 不存在，使用默认样式`);
		}
		const style = styleObj.styles;
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, 'text/html');

		// // 先处理图片网格布局（在应用样式之前）
		// this.groupConsecutiveImages(doc);

		Object.keys(style).forEach(selector => {
			if (selector === 'pre' || selector === 'code' || selector === 'pre code') {
				return;
			}

			// 跳过已经在网格容器中的图片
			const elements = doc.querySelectorAll(selector);
			elements.forEach(el => {
				// 如果是图片且在网格容器内，跳过样式应用
				if (el.tagName === 'IMG' && el.closest('.image-grid')) {
					return;
				}

				const currentStyle = el.getAttribute('style') || '';
				if (el.tagName === 'LI') {
					// 列表带有 <strong> 标签时，要在整体包裹 <p> 标签，否则公众号会为非strong 内容添加 section 块标签
					// 列表项内部添加p标签
					const p = document.createElement('p');

					// 复制源元素的所有子节点
					for (const child of Array.from(el.childNodes)) {
					p.appendChild(child.cloneNode(true));
					}					
					el.innerHTML = '';
					el.appendChild(p);
					// 列表项添加样式
					el.setAttribute('style', currentStyle + '; ' + style["li"]);
				} else {
					// 添加类型断言，确保 TypeScript 知道 selector 是 style 对象的有效键
					el.setAttribute('style', currentStyle + '; ' + style[selector as keyof typeof style]);
				}
				});
		});

		const container = doc.createElement('div');
		container.setAttribute('style', style.container);
		// 将处理后的内容移到新的容器中
		for (const child of Array.from(doc.body.childNodes)) {
			container.appendChild(child.cloneNode(true));
		}
		return container.outerHTML;
	}

	/**
	 * 设置编辑器菜单项（在文件右键菜单中添加"Copy as HTML"选项）
	 */
	private setupEditorMenuEntry() {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _view) => {
				menu.addItem((item) => {
					item
						.setTitle("复制到公众号")  // 菜单项标题
						.setIcon("clipboard-copy")  // 菜单项图标
						.onClick(async () => {
							return this.copyFromFile(file);  // 点击时调用复制方法
						});
				});
			})
		);
	}
	/**
	 * 从文件复制内容（用于文件菜单中的复制操作）
	 * @param file 要复制的文件
	 */
	private async copyFromFile(file: TAbstractFile) {
		// 检查是否是文件（不是文件夹）
		if (!(file instanceof TFile)) {
			console.error(`cannot copy folder to HTML: ${file.path}`);
			return;
		}

		// 检查文件扩展名是否为 .md
		if (file.extension.toLowerCase() !== 'md') {
			console.error(`cannot only copy .md files to HTML: ${file.path}`);
			return;
		}

		// 读取文件内容并复制
		const markdown = await file.vault.cachedRead(file);
		return this.doCopy(markdown, file.path, file.name, true);
	}

	/**
	 * 扩展 HTML 模板，将占位符替换为实际内容
	 * @param html HTML 内容
	 * @param title 文档标题
	 * @returns 完整的 HTML 文档字符串
	 */
	private expandHtmlTemplate(html: string, title: string) {
		// 根据设置决定使用自定义模板还是默认模板
		const template = DEFAULT_HTML_TEMPLATE;

		// 替换模板中的占位符
		return template
			.replace('${title}', title)  // 文档标题
			.replace('${body}', html)    // HTML 内容
			.replace('${stylesheet}', this.settings.styleSheet)  // 样式表
			// .replace('${MERMAID_STYLESHEET}', MERMAID_STYLESHEET);  // Mermaid 图表样式
	}

}


/**
 * 在转换过程中显示进度的模态框
 */
class CopyingToHtmlModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	private _progress: HTMLElement;

	get progress() {
		return this._progress;
	}

	onOpen() {
		const { titleEl, contentEl } = this;
		titleEl.setText('Copying to clipboard');
		this._progress = contentEl.createEl('progress');
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		this._progress.style.width = '100%';
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}


/**
 * 将 Markdown 渲染为 DOM，并进行清理和将图片嵌入为 data URI。
 * 这个是md转成html的核心逻辑
 */
class DocumentRenderer {
	private modal: CopyingToHtmlModal;
	private view: Component;

	// 在决定视图渲染完成之前，最后一个块渲染后需要等待的时间
	private optionRenderSettlingDelay: number = 100;

	// 仅包含与 image/${extension} 不同的 MIME 类型映射
	private readonly mimeMap = new Map([
		['svg', 'image/svg+xml'],
		['jpg', 'image/jpeg'],
	]);

	private readonly externalSchemes = ['http', 'https'];

	private readonly vaultPath: string;
	private readonly vaultLocalUriPrefix: string;
	private readonly vaultOpenUri: string;
	private readonly vaultSearchUri: string;

	constructor(private app: App,

		private options: CopyDocument2MpSettings = DEFAULT_SETTINGS) {
		this.vaultPath = (this.app.vault.getRoot().vault.adapter as FileSystemAdapter).getBasePath()
			.replace(/\\/g, '/');

		this.vaultLocalUriPrefix = `app://local/${this.vaultPath}`;

		this.vaultOpenUri = `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}`;
		this.vaultSearchUri = `obsidian://search?vault=${encodeURIComponent(this.app.vault.getName())}`;

		this.view = new Component();
	}

	/**
	 * 将文档渲染为分离的 HTML Element
	 */
	public async renderDocument(markdown: string, path: string): Promise<HTMLElement> {
		this.modal = new CopyingToHtmlModal(this.app);
		this.modal.open();

		try {
			const topNode = await this.renderMarkdown(markdown, path);
			return await this.transformHTML(topNode);
		} finally {
			this.modal.close();
		}
	}

	/**
	 * 将当前视图渲染为 HTMLElement，展开嵌入的链接
	 * 
	 * @param markdown 要渲染的 Markdown 文本
	 * @param path 当前 Markdown 文件路径，用于处理内部链接、附件等
	 * @returns Promise<HTMLElement> 渲染后的 HTML 元素
	 * 
	 * 注意：
	 * - 这是一个私有方法（private），只能在类内部调用
	 * - 使用 async/await 处理异步渲染
	 */
	private async renderMarkdown(markdown: string, path: string): Promise<HTMLElement> {
		const processedMarkdown = this.preprocessMarkdown(markdown);

		const wrapper = document.createElement('div');
		// wrapper.style.display = 'hidden';
		wrapper.addClass('hidden');
		document.body.appendChild(wrapper);
		// 使用 Obsidian 的 MarkdownRenderer 渲染 Markdown 内容到 wrapper 元素中
		await MarkdownRenderer.render(this.app, processedMarkdown, wrapper, path, this.view);
		await this.untilRendered();

		await this.loadComponents(this.view);

		const result = wrapper.cloneNode(true) as HTMLElement;

		document.body.removeChild(wrapper);

		this.view.unload();
		return result;
	}

	/**
	 * 一些插件可能暴露依赖于 onload() 被调用的组件，但由于我们渲染 Markdown 的方式，这不会发生。
	 * 我们需要在所有组件上调用 onload() 以确保它们正确加载。
	 * 由于这有点 hack（我们需要访问 Obsidian 内部），我们将其限制在我们知道否则无法正确渲染的组件。
	 * 我们尝试确保如果 Obsidian 内部发生变化，这将优雅地失败。
	 */
	private async loadComponents(view: Component) {
		type InternalComponent = Component & {
			_children: Component[];
			onload: () => void | Promise<void>;
		}

		const internalView = view as InternalComponent;

		// 递归调用所有子组件的 onload()，深度优先
		const loadChildren = async (
			component: Component,
			visited: Set<Component> = new Set()
		): Promise<void> => {
			if (visited.has(component)) {
				return;  // 如果已经访问过，跳过
			}

			visited.add(component);

			const internalComponent = component as InternalComponent;

			if (internalComponent._children?.length) {
				for (const child of internalComponent._children) {
					await loadChildren(child, visited);
				}
			}

			try {
				// 依赖于 Sheet 插件（advanced-table-xt）没有被压缩
				if (component?.constructor?.name === 'SheetElement') {
					component.onload();
				}
			} catch (error) {
				console.error(`Error calling onload()`, error);
			}
		};

		await loadChildren(internalView);
	}

	private preprocessMarkdown(markdown: string): string {
		let processed = markdown;

		if (this.options.removeDataviewMetadataLines) {
			processed = processed.replace(/^[^ \t:#`<>][^:#`<>]+::.*$/gm, '');
		}

		return processed;
	}

	/**
	 * 等待视图完成渲染
	 *
	 * 注意，这是一个肮脏的 hack...
	 *
	 * 我们没有可靠的方法知道文档是否已完成渲染。例如，dataviews 或任务块可能尚未进行后处理。
	 * MarkdownPostProcessors 在 HTML 视图中的所有"块"上被调用。因此我们注册一个高优先级（低数字以标记块正在处理）的后处理器，
	 * 和另一个在所有其他后处理器之后运行的低优先级后处理器。
	 * 现在如果我们看到没有块正在被后处理，这可能意味着两件事：
	 *  - 要么我们处于块之间
	 *  - 要么我们完成了视图渲染
	 * 基于连续块后处理之间经过的时间总是非常短（只是迭代，没有工作完成）的前提，
	 * 我们得出结论：如果没有块在足够长的时间内被渲染，则渲染已完成。
	 */
	private async untilRendered() {
		while (ppIsProcessing || Date.now() - ppLastBlockDate < this.optionRenderSettlingDelay) {
			if (ppLastBlockDate === 0) {
				break;
			}
			await delay(20);
		}
	}

	/**
	 * 转换渲染的 Markdown 以清理并嵌入图片
	 */
	private async transformHTML(element: HTMLElement): Promise<HTMLElement> {
		// 移除强制预览垂直填充窗口的样式
		// @ts-ignore
		const node: HTMLElement = element.cloneNode(true);
		node.removeAttribute('style');

		if (this.options.removeFrontMatter) {
			this.removeFrontMatter(node);
		}

		// this.replaceLinksOfClass(node, 'internal-link');
		// this.replaceLinksOfClass(node, 'tag');
		this.makeCheckboxesReadOnly(node);
		this.removeCollapseIndicators(node);
		this.removeButtons(node);
		this.removeStrangeNewWorldsLinks(node);

		// if (this.options.footnoteHandling == FootnoteHandling.REMOVE_ALL) {
		// 	this.removeAllFootnotes(node);
		// }
		// if (this.options.footnoteHandling == FootnoteHandling.REMOVE_LINK) {
		// 	this.removeFootnoteLinks(node);
		// } else if (this.options.footnoteHandling == FootnoteHandling.TITLE_ATTRIBUTE) {
		// 	// not supported yet
		// }

		if (!this.options.disableImageEmbedding) {
			await this.embedImages(node);
			await this.renderSvg(node);
		}

		return node;
	}

	/** Remove front-matter */
	private removeFrontMatter(node: HTMLElement) {
		node.querySelectorAll('.frontmatter, .frontmatter-container')
			.forEach(node => node.remove());
	}

	private makeCheckboxesReadOnly(node: HTMLElement) {
		node.querySelectorAll('input[type="checkbox"]')
			.forEach(node => node.setAttribute('disabled', 'disabled'));
	}

	/** Remove the collapse indicators from HTML, not needed (and not working) in copy */
	private removeCollapseIndicators(node: HTMLElement) {
		node.querySelectorAll('.collapse-indicator')
			.forEach(node => node.remove());
	}

	/** Remove button elements (which appear after code blocks) */
	private removeButtons(node: HTMLElement) {
		node.querySelectorAll('button')
			.forEach(node => node.remove());
	}

	/** 移除由 Strange New Worlds 插件添加的计数器 (https://github.com/TfTHacker/obsidian42-strange-new-worlds) */
	private removeStrangeNewWorldsLinks(node: HTMLElement) {
		node.querySelectorAll('.snw-reference')
			.forEach(node => node.remove());
	}

	/** Remove references to footnotes and the footnotes section */
	private removeAllFootnotes(node: HTMLElement) {
		node.querySelectorAll('section.footnotes')
			.forEach(section => section.parentNode!.removeChild(section));

		node.querySelectorAll('.footnote-link')
			.forEach(link => {
				link.parentNode!.parentNode!.removeChild(link.parentNode!);
			});
	}

	/** Keep footnotes and references, but remove links */
	private removeFootnoteLinks(node: HTMLElement) {
		node.querySelectorAll('.footnote-link')
			.forEach(link => {
				const text = link.getText();
				if (text === '↩︎') {
					// 移除返回链接
					link.parentNode!.removeChild(link);
				} else {
					// 从引用中移除
					const span = link.parentNode!.createEl('span', { text: link.getText(), cls: 'footnote-link' })
					link.parentNode!.replaceChild(span, link);
				}
			});
	}

	/** 将所有图片源替换为 data-uri */
	private async embedImages(node: HTMLElement): Promise<HTMLElement> {
		const promises: Promise<void>[] = [];

		// 替换所有图片源
		node.querySelectorAll('img')
			.forEach(img => {
				if (img.src) {
					if (img.src.startsWith('data:image/svg+xml') && this.options.convertSvgToBitmap) {
						// 图片是 SVG，编码为 data URI。例如 Excalidraw 就是这种情况。
						// 将其转换为位图
						promises.push(this.replaceImageSource(img));
						return;
					}

					// if (!this.options.embedExternalLinks) {
					// 	const [scheme] = img.src.split(':', 1);
					// 	if (this.externalSchemes.includes(scheme.toLowerCase())) {
					// 		// 不处理外部图片
					// 		return;
					// 	} else {
					// 		// 不是外部图片，继续下面的处理
					// 	}
					// }

					if (!img.src.startsWith('data:')) {
						// 渲染位图，除非已经是 data-uri
						promises.push(this.replaceImageSource(img));
						return;
					}
				}
			});

		// @ts-ignore
		this.modal.progress.max = 100;

		// @ts-ignore
		await allWithProgress(promises, percentCompleted => this.modal.progress.value = percentCompleted);
		return node;
	}

	private async renderSvg(node: HTMLElement): Promise<Element> {
		const xmlSerializer = new XMLSerializer();

		if (!this.options.convertSvgToBitmap) {
			return node;
		}

		const promises: Promise<void>[] = [];

		const replaceSvg = async (svg: SVGSVGElement) => {
			// const style: HTMLStyleElement = svg.querySelector('style') || svg.appendChild(document.createElement('style'));

			// 替代 style.innerHTML += MERMAID_STYLESHEET;
			// const textNode = document.createTextNode(MERMAID_STYLESHEET);
			// style.appendChild(textNode);

			const svgAsString = xmlSerializer.serializeToString(svg);

			const svgData = `data:image/svg+xml;base64,` + arrayBufferToBase64(new TextEncoder().encode(svgAsString));
			const dataUri = await this.imageToDataUri(svgData);

			const img = svg.createEl('img');
			img.style.cssText = svg.style.cssText;
			img.src = dataUri;

			svg.parentElement!.replaceChild(img, svg);
		};

		node.querySelectorAll('svg')
			.forEach(svg => {
				promises.push(replaceSvg(svg));
			});

		// @ts-ignore
		this.modal.progress.max = 0;

		// @ts-ignore
		await allWithProgress(promises, percentCompleted => this.modal.progress.value = percentCompleted);
		return node;
	}

	/** replace image src attribute with data uri */
	private async replaceImageSource(image: HTMLImageElement): Promise<void> {
		const imageSourcePath = decodeURI(image.src);

		if (imageSourcePath.startsWith(this.vaultLocalUriPrefix)) {
			// Transform uri to Obsidian relative path
			let path = imageSourcePath.substring(this.vaultLocalUriPrefix.length + 1)
				.replace(/[?#].*/, '');
			path = decodeURI(path);

			const mimeType = this.guessMimeType(path);
			const data = await this.readFromVault(path, mimeType);

			if (this.isSvg(mimeType) && this.options.convertSvgToBitmap) {
				// render svg to bitmap for compatibility w/ for instance gmail
				image.src = await this.imageToDataUri(data);
			} else {
				// file content as base64 data uri (including svg)
				image.src = data;
			}
		} else {
			// Attempt to render uri to canvas. This is not an uri that points to the vault. Not needed for public
			// urls, but we may have un uri that points to our local machine or network, that will not be accessible
			// wherever we intend to paste the document.
			image.src = await this.imageToDataUri(image.src);
		}
	}

	/**
	 * Draw image url to canvas and return as data uri containing image pixel data
	 */
	private async imageToDataUri(url: string): Promise<string> {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');

		const image = new Image();
		image.setAttribute('crossOrigin', 'anonymous');

		const dataUriPromise = new Promise<string>((resolve, _reject) => {
			image.onload = () => {
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;

				ctx!.drawImage(image, 0, 0);

				try {
					const uri = canvas.toDataURL('image/png');
					resolve(uri);
				} catch (err) {
					// leave error at `log` level (not `error`), since we leave an url that may be workable
					console.error(`failed ${url}`, err);
					// if we fail, leave the original url.
					// This way images that we may not load from external sources (tainted) may still be accessed
					// (eg. plantuml)
					// TODO: should we attempt to fallback with fetch ?
					resolve(url);
				}

				canvas.remove();
			}

			image.onerror = () => {
				console.error('could not load data uri');
				// if we fail, leave the original url
				resolve(url);
			}
		})

		image.src = url;

		return dataUriPromise;
	}

	/**
	 * Get binary data as b64 from a file in the vault
	 */
	private async readFromVault(path: string, mimeType: string): Promise<string> {
		const abstractFile = this.app.vault.getAbstractFileByPath(path);
		if (!(abstractFile instanceof TFile)) {
			throw new Error(`File not found: ${path}`);
		}
		const tfile = abstractFile;		const data = await this.app.vault.readBinary(tfile);
		return `data:${mimeType};base64,` + arrayBufferToBase64(data);
	}

	/** Guess an image's mime-type based on its extension */
	private guessMimeType(filePath: string): string {
		const extension = this.getExtension(filePath) || 'png';
		return this.mimeMap.get(extension) || `image/${extension}`;
	}

	/** Get lower-case extension for a path */
	private getExtension(filePath: string): string {
		// avoid using the "path" library
		const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
		return fileName.slice(fileName.lastIndexOf('.') + 1 || fileName.length)
			.toLowerCase();
	}

	private isSvg(mimeType: string): boolean {
		return mimeType === 'image/svg+xml';
	}
}
