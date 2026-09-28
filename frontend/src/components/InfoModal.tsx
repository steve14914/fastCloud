import type { Usage } from '../api'
import { formatBytes } from '../format'
import { Icon } from './Icon'
import { Modal } from './Modal'

/** 맨 아래 info 버튼을 누르면 뜨는 설명 창. 자동 삭제 규칙을 맨 위에 눈에 띄게 적는다. */
export function InfoModal({ usage, onClose }: { usage: Usage | null; onClose: () => void }) {
  const tempDays = usage?.tempDays ?? 30
  const trashDays = usage?.trashDays ?? 30
  const quota = usage?.quotaBytes ? formatBytes(usage.quotaBytes) : '할당 용량'

  return (
    <Modal title="fastcloud 사용법" onClose={onClose}>
      <div className="info">
        <section className="info-danger">
          <h3>
            <Icon name="clock" size={18} /> 파일이 자동으로 삭제돼요
          </h3>
          <ul>
            {tempDays > 0 && (
              <li>
                <strong>임시사진함 · 임시문서함 · 임시파일함</strong>에 들어간 파일은{' '}
                <strong className="info-em">{tempDays}일이 지나면 자동으로 휴지통으로</strong> 가요.
              </li>
            )}
            {trashDays > 0 && (
              <li>
                <strong>휴지통</strong>의 파일은 <strong className="info-em">{trashDays}일이 지나면 영구삭제</strong>되고
                되돌릴 수 없어요.
                {tempDays > 0 && ` 그래서 임시함에 올린 파일은 그냥 두면 ${tempDays + trashDays}일 뒤 완전히 사라져요.`}
              </li>
            )}
            <li>
              사용량이 <strong>{quota}</strong>를 넘으면{' '}
              <strong className="info-em">휴지통에서 가장 오래된 파일부터 바로 영구삭제</strong>돼요 (휴지통 기간과
              상관없이). 휴지통을 다 비워도 모자라면 업로드가 거절돼요.
            </li>
            <li>
              <strong>영구저장소의 파일과 메모는 자동으로 지워지지 않아요.</strong> 남길 파일은 상자 버튼을 눌러
              영구저장소로 보내세요.
            </li>
          </ul>
        </section>

        <section>
          <h3>올리기</h3>
          <ul>
            <li>PC: 화면 아무 데나 파일을 끌어다 놓거나, 캡처한 사진을 Ctrl+V로 붙여넣으면 올라가요.</li>
            <li>폰: 오른쪽 아래 파란 버튼을 눌러 고르세요.</li>
            <li>메인 화면에서 올리면 종류에 따라 임시함으로, 영구저장소의 폴더 안에서 올리면 그 폴더로 들어가요.</li>
          </ul>
        </section>

        <section>
          <h3>임시함 → 영구저장소</h3>
          <ul>
            <li>
              임시함의 상자 버튼(stash)을 누르면 영구저장소의 <strong>'사진', '문서', '기타파일'</strong> 폴더로
              옮겨져요. 폴더가 없으면 자동으로 만들어져요.
            </li>
            <li>영구저장소에서 되돌리기 버튼을 누르면 다시 임시함으로 가고, 그날부터 {tempDays}일을 다시 세요.</li>
            <li>임시함 파일에는 며칠 뒤 지워지는지 표시돼요 (사진은 일주일 안 남았을 때 D-숫자로).</li>
          </ul>
        </section>

        <section>
          <h3>정리하기</h3>
          <ul>
            <li>영구저장소에서 파일이나 폴더를 끌어 폴더에 놓으면 그 안으로, 끄는 동안 위에 뜨는 '상위 폴더로 이동'에 놓으면 한 칸 위로 옮겨져요.</li>
            <li>폰에서는 파일을 길게 누르면 살짝 떠오르고 진동이 와요. 그대로 끌어서 폴더에 놓으세요. 손을 떼면 끝나요.</li>
            <li>
              <strong>선택</strong> 버튼: 파일을 여러 개 고른 뒤 원하는 폴더(또는 임시함)로 가서 아래 막대의 '여기로 이동' /
              '여기로 복사'를 누르세요. 고른 파일을 한꺼번에 휴지통으로 보낼 수도 있어요.
            </li>
          </ul>
        </section>

        <section>
          <h3>보기 · 공유</h3>
          <ul>
            <li>파일을 누르면 사진, PDF, 글자 파일, 동영상을 바로 볼 수 있어요.</li>
            <li>파일 창 아래에서 QR 코드, 링크 복사로 로그인 없이 받을 수 있는 링크를 만들 수 있어요 (24시간 뒤 만료).</li>
            <li>임시사진함 전체 보기에서 큰 미리보기 / 목록 보기를 바꿀 수 있어요.</li>
          </ul>
        </section>

        <section>
          <h3>메모 · 용량</h3>
          <ul>
            <li>메모는 탭으로 여러 개 열어 둘 수 있고, 서식 버튼으로 굵게, 형광펜, 체크리스트를 쓸 수 있어요.</li>
            <li>
              맨 아래 막대는 왼쪽부터 보통 파일, <span className="info-hatch" /> 휴지통, 남은 용량이에요. 80%를 넘으면
              노란색, 90%를 넘으면 빨간색이 돼요.
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  )
}
