import { Outlet } from 'react-router';
import { UnsupportedWidthNotice } from './UnsupportedWidthNotice';

export function RootLayout() {
  return (
    <>
      <UnsupportedWidthNotice />
      <Outlet />
    </>
  );
}
