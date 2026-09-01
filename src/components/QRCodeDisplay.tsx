import { QRCodeSVG } from "qrcode.react";

export default function QRCodeDisplay({ value, size = 200 }: { value: string; size?: number }) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 inline-block">
      <QRCodeSVG
        value={value}
        size={size}
        level="H"
        includeMargin={true}
        className="w-full h-auto"
      />
    </div>
  );
}
