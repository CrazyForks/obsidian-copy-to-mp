import {App, PluginSettingTab, Setting} from "obsidian";
import CopyDocument2MpPlugin from "./main";

/**
 * 脚注处理方式枚举
 */
enum FootnoteHandling {
	/** 移除所有引用和链接 */
	REMOVE_ALL,

	/** 保留链接（使用唯一ID链接到脚注） */
	LEAVE_LINK,

	/** 移除链接（从引用和脚注中移除链接，只显示文本） */
	REMOVE_LINK,

	/** 将脚注移动到 title 属性中（暂不支持） */
	TITLE_ATTRIBUTE
}


/**
 * 内部链接处理方式枚举
 */
enum InternalLinkHandling {
	/**
	 * 转换为文本（移除链接，只显示链接文本）
	 */
	CONVERT_TO_TEXT,

	/**
	 * 转换为 obsidian:// 链接（在 Obsidian 中打开文件或标签）
	 */
	CONVERT_TO_OBSIDIAN_URI,

	/**
	 * 链接到 HTML（保留链接，但将扩展名转换为 .html）
	 */
	LINK_TO_HTML,

	/**
	 * 保持原样（保留生成的链接）
	 */
	LEAVE_AS_IS
}


/**
 * 样式风格枚举
 */
export enum StyleSheetStyle {
	WECHAT_DEFAULT = "wechat-default",
	LATEPOST_DEPTH_DEFAULT = "latepost-depth",
	WECHAT_FT_DEFAULT = "wechat-ft",
	WECHAT_ANTHROPIC_DEFAULT = "wechat-anthropic",
	WECHAT_TECH_DEFAULT = "wechat-tech",
	WECHAT_ELEGANT_DEFAULT = "wechat-elegant",
	WECHAT_DEEPREAD_DEFAULT = "wechat-deepread",
	WECHAT_NYT_DEFAULT = "wechat-nyt",
	WECHAT_JONYIVE_DEFAULT = "wechat-jonyive",
	WECHAT_MEDIUM_DEFAULT = "wechat-medium",
	WECHAT_APPLE_DEFAULT = "wechat-apple",
	KENYA_EMPTINESS_DEFAULT = "kenya-emptiness",
	HISCHE_EDITORIAL_DEFAULT = "hische-editorial",
	ANDO_CONCRETE_DEFAULT = "ando-concrete",
	GAUDI_ORGANIC_DEFAULT = "gaudi-organic",
	GUARDIAN_DEFAULT = "guardian",
	NIKKEEI_DEFAULT = "nikkei",
	LEMONDE_DEFAULT = "lemonde",
}


// 插件设置接口，数据结构定义了插件的所有可配置选项
export interface CopyDocument2MpSettings  {
	/** 是否移除 front-matter（文档开头的 YAML 元数据部分） */
	removeFrontMatter: boolean;

	/** 是否将 SVG 转换为位图（提高兼容性，例如在 Gmail 中） */
	convertSvgToBitmap: boolean;

	/** 是否将代码块渲染为表格（使粘贴到 Google Docs 中更美观） */
	formatCodeWithTables: boolean;

	/** 是否将 callouts（提示框）渲染为表格（使粘贴到 Google Docs 中更美观） */
	formatCalloutsWithTables: boolean;

	/** 是否嵌入外部链接（下载并嵌入其内容） */
	embedExternalLinks: boolean;

	/** 是否移除 dataview 元数据行（格式：`some-tag:: value`） */
	removeDataviewMetadataLines: boolean;

	/** 脚注处理方式 */
	footnoteHandling: FootnoteHandling;

	/** 内部链接处理方式 */
	internalLinkHandling: InternalLinkHandling;

	/** 是否使用自定义样式表 */
	useCustomStylesheet: boolean;

	/**
	 * 是否使用自定义 HTML 模板
	 */
	useCustomHtmlTemplate: boolean;

	/** 样式表内容 */
	styleSheet: string;

	/**
	 * HTML 模板内容
	 */
	htmlTemplate: string;

	/** 是否只生成 HTML 片段（不包含 <head> 部分） */
	bareHtmlOnly: boolean;

	/** 是否在复制时包含文件名作为标题（仅当复制整个文档时生效） */
	fileNameAsHeader: boolean;

	/** 样式风格，默认值为 wechat-default */
	styleSheetStyle: StyleSheetStyle;

	/**
	 * 是否禁用图片嵌入（不推荐，会留下损坏的链接）
	 */
	disableImageEmbedding: boolean;
}
// 插件默认设置，提供了所有选项的默认值
export const DEFAULT_SETTINGS: CopyDocument2MpSettings = {
	convertSvgToBitmap: true,
	removeFrontMatter: true,
	formatCodeWithTables: false,
	embedExternalLinks: false,
	removeDataviewMetadataLines: false,
	footnoteHandling: FootnoteHandling.REMOVE_LINK,
	internalLinkHandling: InternalLinkHandling.CONVERT_TO_TEXT,
	disableImageEmbedding: false,
	useCustomStylesheet: false,
	useCustomHtmlTemplate: false,
	styleSheet: '',
	htmlTemplate: '',
	bareHtmlOnly: false,
	fileNameAsHeader: false,
	styleSheetStyle: StyleSheetStyle.WECHAT_DEFAULT,
	formatCalloutsWithTables: false,
}


export class CopyDocument2MpSettingsTab extends PluginSettingTab {
	plugin: CopyDocument2MpPlugin;

	constructor(app: App, plugin: CopyDocument2MpPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// // 感谢 Obsidian Tasks 插件！
	// private static createFragmentWithHTML = (html: string) => {
	// 	return createFragment((documentFragment) => {
	// 		const div = documentFragment.createDiv();

	// 		// 清空 div 的内容
	// 		div.empty();

	// 		// 使用更安全的方式添加 HTML 内容
	// 		// 创建一个临时的 div 来解析 HTML
	// 		const tempDiv = document.createElement('div');
	// 		tempDiv.innerHTML = html;

	// 		// 将解析后的内容移动到目标 div
	// 		while (tempDiv.firstChild) {
	// 			div.appendChild(tempDiv.firstChild);
	// 		}
	// 	});
	// };

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl).setName("兼容性选项").setHeading()

		new Setting(containerEl)
			.setName('将 SVG 转换为位图')
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc('如果选中，SVG 文件将转换为位图。这会使复制的文档更重，但提高兼容性（例如 Gmail）。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.convertSvgToBitmap)
				.onChange(async (value) => {
					this.plugin.settings.convertSvgToBitmap = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('嵌入外部图片')
			.setDesc('如果选中，外部图片将被下载并嵌入。如果取消选中，生成的文档可能包含指向外部资源的链接')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.embedExternalLinks)
				.onChange(async (value) => {
					this.plugin.settings.embedExternalLinks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName("渲染选项").setHeading()



		new Setting(containerEl)
			.setName('包含文件名作为标题')
			.setDesc('如果选中，文件名将作为一级标题插入。（仅当整个文档被复制时才有效）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.fileNameAsHeader)
				.onChange(async (value) => {
					this.plugin.settings.fileNameAsHeader = value;
					await this.plugin.saveSettings();
				}))

		new Setting(containerEl)
			.setName('移除属性/前置元数据部分')
			.setDesc("如果选中，将移除文档开头位于 --- 行之间的 YAML 内容。如果您不知道这是什么，请保持开启状态。")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.removeFrontMatter)
				.onChange(async (value) => {
					this.plugin.settings.removeFrontMatter = value;
					await this.plugin.saveSettings();
				}));

		// new Setting(containerEl)
		// 	.setName('移除数据视图元数据行')
		// 	.setDesc(CopyDocumentAsHTMLSettingsTab.createFragmentWithHTML(`
		// 		<p>如果选中，将移除仅包含数据视图元数据的行，例如 "rating:: 9"。方括号中的元数据将保持不变。</p>
		// 		<p>当前限制是，以空格开头的行不会被移除，而代码块中的元数据行如果不以空格开头，也会被移除。</p>`))
		// 	.addToggle(toggle => toggle
		// 		.setValue(this.plugin.settings.removeDataviewMetadataLines)
		// 		.onChange(async (value) => {
		// 			this.plugin.settings.removeDataviewMetadataLines = value;
		// 			await this.plugin.saveSettings();
		// 		}));

		// new Setting(containerEl)
		// 	.setName('脚注处理')
		// 	.setDesc(CopyDocumentAsHTMLSettingsTab.createFragmentWithHTML(`
		// 		<ul>
		// 			<li>全部移除：移除引用和链接。</li>
		// 			<li>仅显示：保留引用和脚注，但不显示为链接。</li>
		// 			<li>显示并链接：尝试将引用链接到脚注，根据粘贴目标的不同可能不起作用。</li>
		// 		</ul>`)
		// 	)
		// 	.addDropdown(dropdown => dropdown
		// 		.addOption(FootnoteHandling.REMOVE_ALL.toString(), '全部移除')
		// 		.addOption(FootnoteHandling.REMOVE_LINK.toString(), '仅显示')
		// 		.addOption(FootnoteHandling.LEAVE_LINK.toString(), '显示并链接')
		// 		.setValue(this.plugin.settings.footnoteHandling.toString())
		// 		.onChange(async (value) => {
		// 			switch (value) {
		// 				case FootnoteHandling.TITLE_ATTRIBUTE.toString():
		// 					this.plugin.settings.footnoteHandling = FootnoteHandling.TITLE_ATTRIBUTE;
		// 					break;
		// 				case FootnoteHandling.REMOVE_ALL.toString():
		// 					this.plugin.settings.footnoteHandling = FootnoteHandling.REMOVE_ALL;
		// 					break;
		// 				case FootnoteHandling.REMOVE_LINK.toString():
		// 					this.plugin.settings.footnoteHandling = FootnoteHandling.REMOVE_LINK;
		// 					break;
		// 				case FootnoteHandling.LEAVE_LINK.toString():
		// 				default:
		// 					this.plugin.settings.footnoteHandling = FootnoteHandling.LEAVE_LINK;
		// 					break;
		// 			}
		// 			await this.plugin.saveSettings();
		// 		})
		// 	)

		// 样式选项映射
		const styleOptions: Record<string, StyleSheetStyle> = {
			'默认公众号风格': StyleSheetStyle.WECHAT_DEFAULT,
			'晚点风格': StyleSheetStyle.LATEPOST_DEPTH_DEFAULT,
			'金融时报': StyleSheetStyle.WECHAT_FT_DEFAULT,
			'Claude': StyleSheetStyle.WECHAT_ANTHROPIC_DEFAULT,
			'技术风格': StyleSheetStyle.WECHAT_TECH_DEFAULT,
			'优雅简约': StyleSheetStyle.WECHAT_ELEGANT_DEFAULT,
			'深度阅读': StyleSheetStyle.WECHAT_DEEPREAD_DEFAULT,
			'纽约时报': StyleSheetStyle.WECHAT_NYT_DEFAULT,
			'Jony Ive': StyleSheetStyle.WECHAT_JONYIVE_DEFAULT,
			'Medium 长文': StyleSheetStyle.WECHAT_MEDIUM_DEFAULT,
			'Apple 极简': StyleSheetStyle.WECHAT_APPLE_DEFAULT,
			'原研哉·空': StyleSheetStyle.KENYA_EMPTINESS_DEFAULT,
			'Hische·编辑部': StyleSheetStyle.HISCHE_EDITORIAL_DEFAULT,
			'安藤·清水': StyleSheetStyle.ANDO_CONCRETE_DEFAULT,
			'高迪·有机': StyleSheetStyle.GAUDI_ORGANIC_DEFAULT,
			'Guardian 卫报': StyleSheetStyle.GUARDIAN_DEFAULT,
			'Nikkei 日経': StyleSheetStyle.NIKKEEI_DEFAULT,
			'Le Monde 世界报': StyleSheetStyle.LEMONDE_DEFAULT,
		};

		// 添加 Setting
		new Setting(containerEl)
		.setName('样式风格')
		.setDesc('选择要使用的样式表风格。')
		.addDropdown(dropdown => {
			// 循环添加选项
			Object.entries(styleOptions).forEach(([label, value]) => {
				dropdown.addOption(value, label);
			});
	
			// 设置默认值
			dropdown
				.setValue(this.plugin.settings.styleSheetStyle)
				.onChange(async (value) => {
					this.plugin.settings.styleSheetStyle = value as StyleSheetStyle;
					await this.plugin.saveSettings();
				});
		});


// 		new Setting(containerEl)
// 			.setName('内部链接处理')
// 			.setDesc(CopyDocumentAsHTMLSettingsTab.createFragmentWithHTML(`
// 				<p>此选项控制对 Obsidian 文档和标签的链接的处理方式。</p>
// 				<ul>
// 					<li>Don't link: only render the link title</li>
// 					<li>Open with Obsidian: convert the link to an obsidian:// URI</li> 
// 					<li>Link to HTML: keep the link, but convert the extension to .html</li>
// 					<li>Leave as is: keep the generated link</li>	
// 				</ul>`)
// 			)
// 			.addDropdown(dropdown => dropdown
// 				.addOption(InternalLinkHandling.CONVERT_TO_TEXT.toString(), 'Don\'t link')
// 				.addOption(InternalLinkHandling.CONVERT_TO_OBSIDIAN_URI.toString(), 'Open with Obsidian')
// 				.addOption(InternalLinkHandling.LINK_TO_HTML.toString(), 'Link to HTML')
// 				.addOption(InternalLinkHandling.LEAVE_AS_IS.toString(), 'Leave as is')
// 				.setValue(this.plugin.settings.internalLinkHandling.toString())
// 				.onChange(async (value) => {
// 					switch (value) {
// 						case InternalLinkHandling.CONVERT_TO_OBSIDIAN_URI.toString():
// 							this.plugin.settings.internalLinkHandling = InternalLinkHandling.CONVERT_TO_OBSIDIAN_URI;
// 							break;
// 						case InternalLinkHandling.LINK_TO_HTML.toString():
// 							this.plugin.settings.internalLinkHandling = InternalLinkHandling.LINK_TO_HTML;
// 							break;
// 						case InternalLinkHandling.LEAVE_AS_IS.toString():
// 							this.plugin.settings.internalLinkHandling = InternalLinkHandling.LEAVE_AS_IS;
// 							break;
// 						case InternalLinkHandling.CONVERT_TO_TEXT.toString():
// 						default:
// 							this.plugin.settings.internalLinkHandling = InternalLinkHandling.CONVERT_TO_TEXT;
// 							break;
// 					}
// 					await this.plugin.saveSettings();
// 				})
// 			)

		new Setting(containerEl).setName("自定义模板（待实现）").setHeading()

// 		const useCustomStylesheetSetting = new Setting(containerEl)
// 			.setName('使用自定义样式表（待实现）')
// 			.setDesc('默认样式表提供了基本的主题。您可能需要自定义它以获得更好的外观。禁用此设置将恢复默认样式表。');

// 		const customStylesheetSetting = new Setting(containerEl)
// 			.setClass('customizable-text-setting')
// 			.addTextArea(textArea => textArea
// 				.setValue(this.plugin.settings.styleSheet)
// 				.onChange(async (value) => {
// 					this.plugin.settings.styleSheet = value;
// 					await this.plugin.saveSettings();
// 				}));

// 		useCustomStylesheetSetting.addToggle(toggle => {
// 			customStylesheetSetting.settingEl.toggle(this.plugin.settings.useCustomStylesheet);

// 			toggle
// 				.setValue(this.plugin.settings.useCustomStylesheet)
// 				.onChange(async (value) => {
// 					this.plugin.settings.useCustomStylesheet = value;
// 					customStylesheetSetting.settingEl.toggle(this.plugin.settings.useCustomStylesheet);
// 					if (!value) {
// 						this.plugin.settings.styleSheet = DEFAULT_STYLESHEET;
// 					}
// 					await this.plugin.saveSettings();
// 				});
// 		});

// 		const useCustomHtmlTemplateSetting = new Setting(containerEl)
// 			.setName('使用自定义 HTML 模板（待实现）')
// 			.setDesc(CopyDocumentAsHTMLSettingsTab.createFragmentWithHTML(`For even more customization, you can 
// provide a custom HTML template. Disabling this setting will restore the default template.<br/><br/>
// Note that the template is not used if the "Copy HTML fragment only" setting is enabled.`));

// 		const customHtmlTemplateSetting = new Setting(containerEl)
// 			.setDesc(CopyDocumentAsHTMLSettingsTab.createFragmentWithHTML(`
// 			The template should include the following placeholders :<br/>
// <ul>
// 	<li><code>$\{title}</code>: the document title</li>
// 	<li><code>$\{stylesheet}</code>: the CSS stylesheet. The custom stylesheet will be applied if any is specified</li>
// 	<li><code>$\{MERMAID_STYLESHEET}</code>: the CSS for mermaid diagrams</li>
// 	<li><code>$\{body}</code>: the document body</li>
// </ul>`))
// 			.setClass('customizable-text-setting')
// 			.addTextArea(textArea => textArea
// 				.setValue(this.plugin.settings.htmlTemplate)
// 				.onChange(async (value) => {
// 					this.plugin.settings.htmlTemplate = value;
// 					await this.plugin.saveSettings();
// 				}));

// 		useCustomHtmlTemplateSetting.addToggle(toggle => {
// 			customHtmlTemplateSetting.settingEl.toggle(this.plugin.settings.useCustomHtmlTemplate);

// 			toggle
// 				.setValue(this.plugin.settings.useCustomHtmlTemplate)
// 				.onChange(async (value) => {
// 					this.plugin.settings.useCustomHtmlTemplate = value;
// 					customHtmlTemplateSetting.settingEl.toggle(this.plugin.settings.useCustomHtmlTemplate);
// 					if (!value) {
// 						this.plugin.settings.htmlTemplate = DEFAULT_HTML_TEMPLATE;
// 					}
// 					await this.plugin.saveSettings();
// 				});
// 		});

// 		containerEl.createEl('h3', { text: '其他 / 开发选项' });

// 		new Setting(containerEl)
// 			.setName("禁用图片嵌入")
// 			.setDesc("启用此选项后，图片将不会嵌入 HTML 文档中，而是保留为 <em>损坏的链接</em>。这不是推荐的做法。")
// 			.addToggle(toggle => toggle
// 				.setValue(this.plugin.settings.disableImageEmbedding)
// 				.onChange(async (value) => {
// 					this.plugin.settings.disableImageEmbedding = value;
// 					await this.plugin.saveSettings();
// 				}));
	}
}