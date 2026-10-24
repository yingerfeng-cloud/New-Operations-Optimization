import type { ThemeConfig } from 'antd';

// The shared Ant Design theme for the approved OptiForge visual system.
export const porcelainTheme: ThemeConfig = {
  token: {
    colorPrimary: '#466bc4', colorInfo: '#466bc4', colorSuccess: '#209663',
    colorWarning: '#c58523', colorError: '#ce4444', colorText: '#203149',
    colorTextSecondary: '#66758c', colorBorder: '#dce3ed', colorBgLayout: '#f1f4f8',
    colorBgContainer: '#ffffff', borderRadius: 8, borderRadiusLG: 12,
    borderRadiusSM: 6, controlHeight: 38, fontSize: 14, lineHeight: 1.6,
    fontFamily: '"PingFang SC", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: { borderRadius: 8, controlHeight: 38, paddingInline: 16, primaryShadow: 'none', defaultShadow: 'none', defaultBg: '#edf1f6', defaultBorderColor: 'transparent' },
    Card: { borderRadiusLG: 12, headerFontSize: 16, paddingLG: 20, boxShadowTertiary: '0 3px 14px rgba(32,49,73,.04)' },
    Input: { activeShadow: '0 0 0 3px rgba(70,107,196,.10)', activeBorderColor: '#466bc4', hoverBorderColor: '#91a5d4' },
    Select: { activeBorderColor: '#466bc4', activeOutlineColor: 'rgba(70,107,196,.10)', optionSelectedBg: '#edf2fc' },
    Modal: { borderRadiusLG: 16, paddingLG: 24, titleFontSize: 18, contentBg: '#ffffff', headerBg: '#ffffff', footerBg: '#f6f8fb' },
    Drawer: { paddingLG: 24, borderRadiusLG: 12 },
    Table: { borderRadius: 10, headerBg: '#f7f9fc', headerColor: '#53627a', rowHoverBg: '#f1f5fc', cellPaddingBlock: 14 },
    Tabs: { itemSelectedColor: '#466bc4', inkBarColor: '#466bc4' },
    Steps: { colorPrimary: '#466bc4' },
  },
};
