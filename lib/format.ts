// Định dạng số chuẩn crypto (dùng dấu chấm thập phân ., không dùng dấu phẩy tránh nhầm hàng nghìn)
export const f = (v: number): string => {
  if (v === undefined || v === null || isNaN(v)) return "0";
  if (v > 0 && v < 0.01) {
    return v.toLocaleString("en-US", { maximumSignificantDigits: 5 });
  }
  return v.toLocaleString("en-US", {
    maximumFractionDigits: v > 1000 ? 2 : v > 1 ? 3 : 6,
    useGrouping: true,
  });
};

