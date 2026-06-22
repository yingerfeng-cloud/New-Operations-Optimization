import { render,screen } from '@testing-library/react'; import { StatusTag } from '../../components/StatusTag';
test('renders status',()=>{render(<StatusTag status="SUCCESS"/>);expect(screen.getByText('SUCCESS')).toBeInTheDocument()});
