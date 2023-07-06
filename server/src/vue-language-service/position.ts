/** 位置管理器，将 source 编译为 target 后对位置映射进行管理 */
export class PositionManager {
    /**
     * 位置管理器
     * @param source 编译前的位置列表
     * @param target 与 source 对应的编译后的位置列表
     */
    constructor(public source: number[], public target: number[]) {
        if (source.length !== target.length) {
            throw "[PositionManager]: The length of the `source` must be equal to the length of the `target`.";
        }
    }

    /** 根据编译后的位置获取编译前的位置 */
    positionAtSource(offset: number): number {
        for (let i = 1; i < this.target.length; i++) {
            const pos = this.target[i];
            if (offset < pos) {
                return this.source[i - 1] + offset - this.target[i - 1];
            }
        }
        const last = this.source.length - 1;
        return this.source[last] + offset - this.target[last];
    }

    /** 根据编译前的位置获取编译后的位置 */
    positionAtTarget(offset: number): number {
        for (let i = 1; i < this.source.length; i++) {
            const pos = this.source[i];
            if (offset < pos) {
                return this.target[i - 1] + offset - this.source[i - 1];
            }
        }
        const last = this.source.length - 1;
        return this.target[last] + offset - this.source[last];
    }
}