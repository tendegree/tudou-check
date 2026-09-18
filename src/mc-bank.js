// MC 知识题库（答题签到用）。
// generate 接口随机抽题、不含答案；verify 需提交匹配选项原文的 answer。
// 题库以"题干关键词→正确选项"映射存储。命中不足的新题需人工补充 (sed 追加)。

// 键：题干用于匹配的关键片段（子串匹配，命中任一即可）
// 值：正确答案（须与 options 中某一项完全一致）
export const MC_ANSWER_BY_QUESTION_KEYWORD = {
  '漏斗': '每 8 游戏刻 1 个物品（约 2.5 个/秒）', // 漏斗真实间隔 8pt，实测 verify 200
  '海豚靠近玩家时会给予什么效果': '海豚的恩惠',
  '在下界使用床会发生什么': '爆炸',
  '使用床在下列哪个维度中才会爆炸': '爆炸',
  '修补附魔的工作原理': '用获得的经验值修复物品耐久',
  '不能作为熔炉燃料': '圆石',
  '床的颜色取决于什么材料': '羊毛的颜色',
  'F3+B 调试组合键的作用': '显示实体的判定箱（hitbox）',
  '弃用了原有的 1.x 版本号': '"年份.顺序号"（如 26.1、26.2）',
  '命名牌写上哪个名字，会让大多数生物的渲染上下颠倒': 'Dinnerbone',
  '26.1 把游戏的默认分配内存': '从 2 GB 提升到 4 GB', // 实为建议值，待核对
  '音符盒会触发新的小号': '铜方块', // 26.1 新音色
  'Chaos Cubed 更新将新增哪两组方块': '硫磺（Sulfur）方块组与朱砂（Cinnabar）方块组',
  '以下哪种生物的掉落物可以制作': '', // 待补
};

// 供 verify 时从 options 中精确取该正确答案。
export function correctOption(question, options) {
  for (const [key, ans] of Object.entries(MC_ANSWER_BY_QUESTION_KEYWORD)) {
    if (!ans) continue;
    if (question.includes(key)) {
      const hit = options.find((o) => o === ans);
      if (hit) return hit;
    }
  }
  return null;
}