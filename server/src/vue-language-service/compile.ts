import { Node, TokenType } from "vscode-html-languageservice";
import { PositionManager } from './position';
import { htmlLanguageService } from './host';

/**
 * 编译 template 为 ts 下仅用于提供编译信息的 render 函数
 * @param templateString 模版字符串
 * @param template 模版节点
 * @param offset 位置偏移量，即 render 函数开始位置
 * @param predefineList 预定义变量
 * @returns render 函数相关信息
 */
export function compileTemplate2Render(
    templateString: string,
    template: Node,
    offset: number,
    predefineList: string[],
) {
    const header = "render(){";
    const footer = "}";
    const predefine = `const {${[predefineList].join(',')}} = this;`;
    const source: number[] = [];
    const target: number[] = [];
    const body = compileNode(templateString, template, source, target, offset + header.length + predefine.length);
    const render = [
        header,
        predefine,
        body,
        footer,
    ].join("");
    const position = new PositionManager(source, target);
    return {
        render,
        position
    };
}

/** 属性绑定或指令 */
export const bindingReg = /^:|^v-\w+/;

/** 获取函数主体部分，并将映射位置加入 source 和 target */
function compileNode(
    templateString: string, 
    node: Node,
    source: number[],
    target: number[],
    offset: number,
    body = ""
): string {
    const attributeNames = node.attributes ? Object.keys(node.attributes) : [];
    const isStatic = attributeNames.every(name => !bindingReg.test(name));
    let suffix = "";
    if (!isStatic) {
        const scanner = htmlLanguageService.createScanner(templateString, node.start);
        const tokens: string[] = [];
        let token = scanner.scan();
        while(scanner.getTokenOffset() < node.end) {
            tokens.push(scanner.getTokenText());
            if (token === TokenType.AttributeValue) {
                const name = tokens[tokens.length - 3];
                let value = tokens[tokens.length - 1];
                value = value.slice(1, value.length - 1); // 去掉两侧引号
                const valueOffset = scanner.getTokenOffset() + 1; // + 1 是去掉引号的偏移
                const updatePosition = () => {
                    source.push(valueOffset);
                    target.push(offset + body.length);
                };
                switch (name) {
                    case "v-if":
                        body += "if(";
                        updatePosition();
                        body += `${value}){`;
                        suffix = "}";
                        break;
                    case "v-else-if":
                        body += "else if(";
                        updatePosition();
                        body += `${value}){`;
                        suffix = "}";
                        break;
                    case "v-else":
                        body += "}else{";
                        suffix = "}";
                        break;
                    case "v-for":
                        body += "for(const ";
                        updatePosition();
                        body += `${value.replace(/\sin\s/, " of ")}){`;
                        suffix = "}";
                        break;
                    default:
                        if (bindingReg.test(name)) {
                            source.push(valueOffset);
                            target.push(offset + body.length);
                            body += `${value};`;
                        }
                }
            } else if (token === TokenType.Content) {
                const vueTemplateRegex = /{{\s*(.*?)\s*}}+/g;
                const content = scanner.getTokenText();
                let match = vueTemplateRegex.exec(content);
                while (match) {
                    source.push(scanner.getTokenOffset() + match.index + match[0].indexOf(match[1]));
                    target.push(offset + body.length);
                    body += `${match[1]};`;
                    match = vueTemplateRegex.exec(content);
                }
            }
            token = scanner.scan();
        }
    }
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        body = compileNode(templateString, child, source, target, offset, body);
    }
    body += suffix;
    return body;
}
