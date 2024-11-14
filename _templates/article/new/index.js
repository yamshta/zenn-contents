module.exports = [
  {
    type: "input",
    name: "slug",
    message: "記事のスラッグを入力してください（URLとして使用されます）",
    validate: (input) => {
      const pattern = /^[a-z0-9_-]{12,50}$/;
      if (!input) return "スラッグは必須です";
      if (!pattern.test(input)) {
        return "スラッグは小文字の半角英数字(a-z0-9)、ハイフン(-)、アンダースコア(_)の12〜50字の組み合わせである必要があります";
      }
      return true;
    },
    initial: `article-${new Date().toISOString().split("T")[0]}`,
  },
  {
    type: "input",
    name: "emoji",
    message: "記事のアイコンを入力してください（1文字の絵文字）",
    validate: (input) => {
      if (!input) return "絵文字は必須です";
      if (input.length !== 2) return "1つの絵文字を入力してください";
      return true;
    },
    initial: "✍️",
  },
  {
    type: "select",
    name: "type",
    message: "記事のタイプを選択してください",
    choices: ["tech", "idea"],
    initial: "tech",
  },
  {
    type: "input",
    name: "title",
    message: "記事のタイトルを入力してください",
    validate: (input) => {
      if (!input) return "タイトルは必須です";
      return true;
    },
    initial: "記事のタイトルは未定です",
  },
  {
    type: "toggle",
    name: "publication_name",
    message: "Publicationに紐付けますか？",
    initial: true,
  },
];
